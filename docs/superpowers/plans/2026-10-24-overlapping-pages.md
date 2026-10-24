# Inkdown Overlapping Two Pages Implementation Plan

> For agentic workers: execute inline with superpowers:executing-plans. User authorized both continuous flow and the Word-like fallback; use the fallback without another approval loop.

**Goal:** Show adjacent editable pages and advance by one page: 1-2, 2-3, 3-4.
**Architecture:** Keep the single live Muya tree and CSS multicol flow. Cache one-column width as page stride, measure total columns only after content/viewport changes, and navigate adjacent pairs. Accumulate small wheel input; one ordinary wheel notch advances one page. Use native snap targets to avoid partial pages after horizontal gestures. Two lightweight paper frames stay outside editable content.
**Tech Stack:** Existing Vue/TypeScript, Muya, Chromium CSS multicol, existing Electron test harness.
**Spec:** Latest user instruction dated 2026-10-24: Word-style fallback allowed; 1-2 changes to 2-3 per wheel step. Existing instruction: build out for bat, do not package.

## Constraints
- Preserve current uncommitted work, source bytes, active undo history and source-preview layout.
- No version bump, commit, push, packaging or remote publication.
- All document-based profiling is offline; never send PlantUML source to a remote server.
- Single-column scrolling retains no cancelable wheel handler.

## Review Focus
- First/final page clamping and one-page documents.
- Trackpad small deltas, reversal, Ctrl/Shift wheel and nested code/table scroll.
- New content, final-caret jumps, resizing and cached tabs.
- No full-document geometry reads on plain navigation.
- Card frames and snap markers must not enter Markdown or intercept editing.

## Tasks
- [x] RED: real Electron regression checks page overlap and clamping against current out.
- [x] Implement one-column navigation, wheel accumulation, range labels and paper surfaces in EditorHost.vue / i18n.ts.
- [x] Update existing performance regression to match the new one-page wheel contract.
- [x] Build out; run web types, existing 49 unit regressions, new page regression, performance regression and existing UI acceptance. Review screenshots and targeted code changes.

## Ledger
- User preferred continuous simultaneous vertical flow; selected the explicitly allowed Word-like fallback because the existing one-tree layout supports it without duplicate editors and rendering.
- Repository Git work-tree query currently fails; preserve files in place and perform no Git mutations.

- Red/green boundary checks added for stale page labels, A-long/B-short restore, caret crossing the right boundary and rapid tab switching before a restore frame. Logical page restore is session-owned and applied only after its own snap targets render.

- Final verification: build and web types passed; adjacent-page acceptance 22/22, comprehensive-document performance 15/15, UI acceptance 30/30, existing unit regressions 49/49. Screenshots reviewed. Only out was rebuilt; no packaging, version change, commit or push.
