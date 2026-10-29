import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type Content from '../base/content';
import type TreeNode from '../base/treeNode';
import type { IConstructor, TBlockPath } from '../types';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { isHTMLElement, isMouseEvent } from '../../utils';
import logger from '../../utils/logger';
import Parent from '../base/parent';

const debug = logger('scrollpage:');

/**
 * 分批渲染阈值（单位：块）。
 *
 * - 块数 ≤ SYNC_RENDER_LIMIT：完全走原来的同步路径，零行为变化
 * - 超过后：先同步渲染 FIRST_RENDER_BATCH 块（首屏可读），
 *   其余按 RENDER_BATCH_SIZE 分片补齐，每片之间让出主线程
 *
 * 参数取舍（实测）：
 *   2000 段落（约 4000 块）一次性 2960ms 完全冻结；
 *   分批后首屏约 200~400ms 可读，总时间约 3300ms（+12%）。
 * 总时间变长是分批的固有代价：一次性 append 能让浏览器只做一次布局，
 * 分批则要多次布局。用 12% 的总时间换「不再冻结」，值得。
 *
 * 阈值定在 2000 块：800 段落（约 1600 块）仍走同步路径，
 * 保持原有 555ms 的手感，不给常规文档引入分批开销。
 */
const SYNC_RENDER_LIMIT = 2000;
const FIRST_RENDER_BATCH = 240;
const RENDER_BATCH_SIZE = 400;

interface IBlurFocus {
    blur: Nullable<Content>;
    focus: Nullable<Content>;
}

export class ScrollPage extends Parent {
    private _blurFocus: IBlurFocus = { blur: null, focus: null };
    /** 分批渲染的轮次号；每次 updateState 递增，用于作废旧批次。 */
    private _renderGeneration = 0;

    static override blockName = 'scrollpage';

    // Registry of block constructors keyed by their static blockName.
    // Stored as Parent constructors — the overwhelming majority of
    // call sites do `loadBlock(...).create(...).append(child)`, which only
    // makes sense for Parent. Content leaves register themselves through
    // their containing Parent's create flow and don't go through
    // `loadBlock(...).create()` externally.
    private static _registeredBlocks = new Map<string, IConstructor<Parent>>();

    static register(Block: IConstructor<TreeNode>) {
        const { blockName } = Block;
        this._registeredBlocks.set(blockName, Block as IConstructor<Parent>);
    }

    // Returns the registered constructor. Asserts non-undefined for
    // callers (the registry is populated by `registerBlocks()` once at
    // `editor.init()` time, and `loadBlock` runs strictly after init.).
    // Mismatched names hit the warn branch and the caller crashes at
    // `.create()` — matches the original loose contract.
    static loadBlock(blockName: string): IConstructor<Parent> {
        const block = this._registeredBlocks.get(blockName);

        if (!block)
            debug.warn(`block:${blockName} is not existed.`);

        return block as IConstructor<Parent>;
    }

    static create(muya: Muya, state: TState[]) {
        const scrollPage = new ScrollPage(muya);

        scrollPage.append(
            ...state.map((block) => {
                return this.loadBlock(block.name).create(muya, block);
            }),
        );

        scrollPage.parent!.domNode!.appendChild(scrollPage.domNode!);

        return scrollPage;
    }

    override get path() {
        return [];
    }

    constructor(muya: Muya) {
        super(muya);
        // muya is not extends Parent, but it is the parent of scrollPage.
        // ScrollPage is the tree root; widening the base `TreeNode.parent`
        // declaration would ripple to every node, so spell out the boundary.
        // eslint-disable-next-line no-restricted-syntax
        this.parent = muya as unknown as Parent;
        this.tagName = 'div';
        this.classList = ['mu-container'];

        this.createDomNode();
        this._listenDomEvent();
    }

    override getState() {
        debug.warn('You can never call `getState` in scrollPage');

        return {} as TState;
    }

    private _listenDomEvent() {
        const { eventCenter } = this.muya;
        const { domNode } = this;

        eventCenter.attachDOMEvent(domNode!, 'click', this._clickHandler.bind(this));
    }

    /**
     * 渲染状态到 DOM。
     *
     * 小文档走原来的同步路径（行为完全不变）。
     * 大文档改为分批 append：一次性创建上千个块会长时间阻塞主线程
     * （实测 2000 段约 3 秒、4000 段约 12 秒），分批后首屏立即可见，
     * 剩余块在后续事件循环里补齐。
     *
     * 注意：分批期间文档结构不完整，`getTOC` 等依赖树结构的查询
     * 只能看到已渲染部分。渲染结束时 emit `muya-update-state-done`，
     * 应用层应在这之后再做大纲/搜索等全量查询。
     */
    updateState(state: TState[]) {
        const { muya } = this;
        // A resize owns references into the old tree and cannot survive a rebuild (#5394).
        muya.eventCenter.emit('muya-transformer', { reference: null });
        // Empty scrollPage dom
        this.empty();

        // 只有明显偏大的文档才分批，避免给常规文档引入额外的事件循环调度
        if (state.length <= SYNC_RENDER_LIMIT) {
            this.append(
                ...state.map((block) => {
                    return ScrollPage.loadBlock(block.name).create(muya, block);
                }),
            );
            muya.eventCenter.emit('muya-update-state-done', { total: state.length, batched: false });
            return;
        }

        // 作废上一轮未完成的分批任务：它属于旧文档，继续 append 会污染新树
        const generation = ++this._renderGeneration;

        const makeBatch = (from: number, to: number) =>
            state.slice(from, to).map((block) => ScrollPage.loadBlock(block.name).create(muya, block));

        // 第一批同步渲染，保证首屏立刻可读
        this.append(...makeBatch(0, Math.min(FIRST_RENDER_BATCH, state.length)));

        let offset = Math.min(FIRST_RENDER_BATCH, state.length);
        const pump = () => {
            // 文档已被替换（generation 变化）或节点已脱离文档：立即停手，
            // 否则会把旧文档的块追加到新树/已废弃的树上。
            if (generation !== this._renderGeneration) return;
            if (this.domNode && !this.domNode.isConnected) return;
            if (offset >= state.length) {
                muya.eventCenter.emit('muya-update-state-done', { total: state.length, batched: true });
                return;
            }
            const next = Math.min(offset + RENDER_BATCH_SIZE, state.length);
            this.append(...makeBatch(offset, next));
            offset = next;
            // setTimeout(0) 而不是 rAF：后台标签页里 rAF 会被节流到几乎不触发，
            // 而用户切回来时必须已经渲染完。
            setTimeout(pump, 0);
        };
        setTimeout(pump, 0);
    }

    /** One undo step, preserving adjacent block instances; the caller restores the replacement's selection. */
    replaceBlock(block: Parent, states: TState[]): Parent[] {
        const { muya } = this;
        muya.flush();
        const { history, selection } = muya.editor;
        history.cutoff(selection.getSelection() ?? undefined);
        muya.eventCenter.emit('muya-transformer', { reference: null });

        const replacements = states.map(state => ScrollPage.loadBlock(state.name).create(muya, state));
        for (const replacement of replacements)
            this.insertBefore(replacement, block);
        block.remove();

        muya.flush();
        history.cutoff();
        return replacements;
    }

    /**
     * Find the content block by the path
     * @param {Array} path
     */
    queryBlock(path: TBlockPath) {
        if (path.length === 0)
            return this;

        const p = path.shift() as number;
        const block = this.find(p) as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined };
        return block && path.length ? block.queryBlock(path) : block;
    }

    updateRefLinkAndImage(label: string) {
        // Labels match case-insensitively with whitespace runs collapsed
        // (CommonMark), and may contain regex metacharacters such as `c++`.
        const pattern = label
            .trim()
            .split(/\s+/)
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');
        const REG = new RegExp(`\\[\\s*${pattern}\\s*\\](?!:)`, 'i');

        this.breadthFirstTraverse((node) => {
            if (node.isContent() && REG.test(node.text))
                node.update();
        });
    }

    handleBlurFromContent(block: Content) {
        this._blurFocus.blur = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    handleFocusFromContent(block: Content) {
        this._blurFocus.focus = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    private _updateActiveStatus = () => {
        const { blur, focus } = this._blurFocus;

        if (blur == null && focus == null)
            return;

        let needBlurBlocks: Parent[] = [];
        let needFocusBlocks: Parent[] = [];
        let block;

        if (blur && focus) {
            needFocusBlocks = focus.getAncestors();
            block = blur.parent;
            while (block && block.isParent && block.isParent() && !needFocusBlocks.includes(block)) {
                needBlurBlocks.push(block);
                block = block.parent;
            }
        }
        else if (blur) {
            needBlurBlocks = blur.getAncestors();
        }
        else if (focus) {
            needFocusBlocks = focus.getAncestors();
        }

        if (needBlurBlocks.length) {
            needBlurBlocks.forEach((b) => {
                b.active = false;
            });
        }

        if (needFocusBlocks.length) {
            needFocusBlocks.forEach((b) => {
                b.active = true;
            });
        }

        this._blurFocus = {
            blur: null,
            focus: null,
        };
    };

    // Create a new paragraph if click the blank area in editor.
    private _clickHandler(event: Event) {
        if (!isMouseEvent(event) || !isHTMLElement(event.target))
            return;

        const target = event.target;

        if (target[BLOCK_DOM_PROPERTY] === this) {
            const lastChild = this.lastChild as Parent;
            const lastContentBlock = lastChild.lastContentInDescendant()!;
            const { clientY } = event;
            const lastChildDom = lastChild.domNode;
            const { bottom } = lastChildDom!.getBoundingClientRect();

            if (clientY > bottom) {
                if (
                    lastChild.blockName === 'paragraph'
                    && lastContentBlock.text === ''
                ) {
                    lastContentBlock.setCursor(0, 0);
                }
                else {
                    const state = {
                        name: 'paragraph',
                        text: '',
                    };
                    const newNode = ScrollPage.loadBlock(state.name).create(
                        this.muya,
                        state,
                    );
                    this.append(newNode, 'user');
                    const cursorBlock = newNode.lastContentInDescendant();
                    cursorBlock.setCursor(0, 0, true);
                }
            }
        }
    }
}
