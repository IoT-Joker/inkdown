"""校验导出的 PDF 内容：确认是文档而非应用界面截图。

通过提取 PDF 的文本流并检查关键字符串判断：
- 应包含文档正文
- 不应包含应用外壳文字（侧边栏/标签栏/状态栏标签）
"""
import re
import sys
import zlib

path = sys.argv[1]

with open(path, 'rb') as f:
    raw = f.read()

print(f'文件大小: {len(raw)} bytes')
print(f'头部: {raw[:8]!r}')

# 收集所有 FlateDecode 流并解压，拼接成可搜索文本
texts = []
for m in re.finditer(rb'stream\r?\n', raw):
    start = m.end()
    end = raw.find(b'endstream', start)
    if end == -1:
        continue
    chunk = raw[start:end]
    try:
        texts.append(zlib.decompress(chunk))
    except Exception:
        texts.append(chunk)

blob = b'\n'.join(texts)

# PDF 文本常以 Tj/TJ 操作符出现，中文多为 UTF-16BE 十六进制或内嵌字体编码，
# 因此同时检查 ASCII 关键词与原始字节
def has(pattern: bytes) -> bool:
    return pattern in blob or pattern in raw

checks = [
    ('文档正文标记', b'workflow') ,
    ('文档中文（UTF-16BE 编码）', '文件工作流测试'.encode('utf-16-be')),
    ('文档中文（UTF-8）', '文件工作流测试'.encode('utf-8')),
    ('应用外壳-侧边栏', '打开文件夹'.encode('utf-8')),
    ('应用外壳-状态栏', '所见即所得'.encode('utf-8')),
    ('应用外壳-标签栏提示', '关闭标签页'.encode('utf-8')),
]

print('\n内容检查:')
for name, pat in checks:
    print(f'  {name:26s} {"命中" if has(pat) else "未命中"}')

# 页数（粗略统计 /Type /Page 对象）
pages = len(re.findall(rb'/Type\s*/Page[^s]', raw))
print(f'\n页数（粗略）: {pages}')
