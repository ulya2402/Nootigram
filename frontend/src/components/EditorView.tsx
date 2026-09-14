import React, { useState, useRef, useEffect } from 'react';
import { NoteItem, ContentBlock, TaskItem, TableCell, TopicItem } from '../types';
import { t } from '../services/i18n';
import { exportNoteToTelegram } from '../services/api';

interface EditorViewProps {
  note: NoteItem;
  topics: TopicItem[];
  onBack: () => void;
  onSave: (updated: NoteItem) => void;
  onDelete: (id: string) => void;
}

export const EditorView: React.FC<EditorViewProps> = ({
  note,
  topics,
  onBack,
  onSave,
  onDelete,
}) => {
  const initialBlocks = note.blocks && note.blocks.length > 0
    ? note.blocks
    : [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' } as ContentBlock];

  const [currentNote, setCurrentNote] = useState<NoteItem>({ ...note, blocks: initialBlocks });
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.BackButton) {
      tg.BackButton.show();
      const handleNativeBack = () => {
        triggerHaptic();
        onBack();
      };
      tg.BackButton.onClick(handleNativeBack);

      return () => {
        tg.BackButton.offClick(handleNativeBack);
        tg.BackButton.hide();
      };
    }
  }, [onBack]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const persistChange = (updated: NoteItem) => {
    const safeBlocks = updated.blocks.length === 0
      ? [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' } as ContentBlock]
      : updated.blocks;

    const finalized = { ...updated, blocks: safeBlocks };
    setCurrentNote(finalized);
    onSave(finalized);
  };

  const handleTitleChange = (title: string) => {
    persistChange({ ...currentNote, title });
  };

  const updateBlock = (index: number, newBlock: ContentBlock) => {
    const nextBlocks = [...currentNote.blocks];
    nextBlocks[index] = newBlock;
    persistChange({ ...currentNote, blocks: nextBlocks });
  };

  const removeBlock = (index: number) => {
    triggerHaptic('medium');
    const filtered = currentNote.blocks.filter((_, i) => i !== index);
    persistChange({ ...currentNote, blocks: filtered });
  };

  const appendBlockWithParagraph = (type: ContentBlock['type'], size?: 2 | 3 | 4) => {
    triggerHaptic('medium');
    const bId1 = `b-${Date.now()}-1`;
    const bId2 = `b-${Date.now()}-2`;
    let primaryBlock: ContentBlock;

    switch (type) {
      case 'heading':
        primaryBlock = { id: bId1, type: 'heading', size: size || 2, text: '' };
        break;
      case 'paragraph':
        primaryBlock = { id: bId1, type: 'paragraph', text: '' };
        break;
      case 'quote':
        primaryBlock = { id: bId1, type: 'quote', text: '', credit: '' };
        break;
      case 'list':
        primaryBlock = {
          id: bId1,
          type: 'list',
          items: [{ id: `task-${Date.now()}`, text: '', is_checked: false }],
        };
        break;
      case 'table':
        primaryBlock = {
          id: bId1,
          type: 'table',
          cells: [
            [
              { text: 'A', is_header: true, align: 'left' },
              { text: 'B', is_header: true, align: 'right' },
            ],
            [
              { text: '', align: 'left' },
              { text: '', align: 'right' },
            ],
          ],
        };
        break;
      case 'code':
        primaryBlock = { id: bId1, type: 'code', text: '', language: 'javascript' };
        break;
      case 'math':
        primaryBlock = { id: bId1, type: 'math', expression: 'E = mc^2' };
        break;
      case 'details':
        primaryBlock = { id: bId1, type: 'details', summary: '', text: '' };
        break;
      case 'divider':
        primaryBlock = { id: bId1, type: 'divider' };
        break;
    }

    const trailingParagraph: ContentBlock = {
      id: bId2,
      type: 'paragraph',
      text: '',
    };

    const nextBlocks =
      type === 'paragraph'
        ? [...currentNote.blocks, primaryBlock]
        : [...currentNote.blocks, primaryBlock, trailingParagraph];

    persistChange({ ...currentNote, blocks: nextBlocks });
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }, 60);
  };

  const addTableRow = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;

    const columnCount = tableBlock.cells[0]?.length || 2;
    const newRow: TableCell[] = Array.from({ length: columnCount }, () => ({ text: '', align: 'left' }));
    const updatedCells = [...tableBlock.cells, newRow];
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells });
  };

  const addTableColumn = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;

    const updatedCells = tableBlock.cells.map((row, rIdx) => [
      ...row,
      { text: '', is_header: rIdx === 0, align: 'left' as const },
    ]);
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells });
  };

  const handleExport = async () => {
    triggerHaptic('medium');
    setIsExporting(true);

    const richBlocks: any[] = [];
    if (currentNote.title.trim()) {
      richBlocks.push({ type: 'heading', size: 1, text: currentNote.title });
    }

    currentNote.blocks.forEach((b) => {
      if (b.type === 'heading') {
        richBlocks.push({ type: 'heading', size: b.size, text: b.text });
      } else if (b.type === 'paragraph') {
        if (b.text.trim()) richBlocks.push({ type: 'paragraph', text: b.text });
      } else if (b.type === 'quote') {
        richBlocks.push({
          type: 'blockquote',
          blocks: [{ type: 'paragraph', text: b.text }],
          credit: b.credit,
        });
      } else if (b.type === 'list') {
        richBlocks.push({
          type: 'list',
          items: b.items.map((i) => ({
            has_checkbox: true,
            is_checked: i.is_checked,
            blocks: [{ type: 'paragraph', text: i.text }],
          })),
        });
      } else if (b.type === 'table') {
        richBlocks.push({
          type: 'table',
          is_bordered: true,
          is_striped: true,
          cells: b.cells,
        });
      } else if (b.type === 'code') {
        richBlocks.push({ type: 'pre', text: b.text, language: b.language });
      } else if (b.type === 'math') {
        richBlocks.push({ type: 'mathematical_expression', expression: b.expression });
      } else if (b.type === 'details') {
        richBlocks.push({
          type: 'details',
          summary: b.summary,
          blocks: [{ type: 'paragraph', text: b.text }],
        });
      } else if (b.type === 'divider') {
        richBlocks.push({ type: 'divider' });
      }
    });

    const exportPayload = {
      ...currentNote,
      blocks: richBlocks as any,
    };
    onSave(exportPayload);

    const success = await exportNoteToTelegram(exportPayload);
    setIsExporting(false);
    if (success) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setExportNotice(t('exported'));
    } else {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      setExportNotice(t('export_failed'));
    }
    setTimeout(() => setExportNotice(null), 2500);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="flex flex-col w-full h-full overflow-y-auto px-6 animate-page-fade"
      style={{ paddingBottom: 'calc(var(--keyboard-inset, 0px) + 5rem)' }}
    >
      <div className="sticky top-0 z-30 bg-[#FAF8F5]/95 safe-header-box pb-2 border-b border-cream-divider flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[200px]">
            {topics.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  triggerHaptic();
                  persistChange({ ...currentNote, category: cat.id });
                }}
                className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider shrink-0 transition-colors ${
                  currentNote.category === cat.id
                    ? 'bg-warm-accent text-white'
                    : 'bg-cream-surface text-warm-muted'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="h-7 px-2.5 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-medium flex items-center gap-1 physics-bounce"
            >
              <span className="material-symbols-outlined text-[14px]">send</span>
              <span>{isExporting ? t('exporting') : exportNotice || t('export_rich')}</span>
            </button>
            <button
              onClick={() => {
                triggerHaptic('medium');
                if (window.confirm(t('delete_confirm'))) {
                  onDelete(currentNote.id);
                }
              }}
              className="w-7 h-7 flex items-center justify-center text-warm-muted hover:text-red-600 physics-bounce"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>

        <div className="w-full flex items-center gap-1 overflow-x-auto no-scrollbar py-1 text-warm-text">
          <button
            onClick={() => appendBlockWithParagraph('paragraph')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">format_paragraph</span>
            <span>{t('tool_paragraph')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('heading', 2)}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">format_h2</span>
            <span>{t('tool_h2')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('heading', 3)}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">format_h3</span>
            <span>{t('tool_h3')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('list')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">check_box</span>
            <span>{t('tool_task')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('table')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">table_rows</span>
            <span>{t('tool_table')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('quote')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">format_quote</span>
            <span>{t('tool_quote')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('code')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">code</span>
            <span>{t('tool_code')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('math')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">functions</span>
            <span>{t('tool_math')}</span>
          </button>
          <button
            onClick={() => appendBlockWithParagraph('divider')}
            className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
          >
            <span className="material-symbols-outlined text-[14px]">horizontal_rule</span>
            <span>{t('tool_divider')}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col pt-3">
        <textarea
          rows={1}
          value={currentNote.title}
          placeholder={t('title_placeholder')}
          onInput={(e) => autoResize(e.currentTarget)}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="text-2xl font-bold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle w-full mb-3 resize-none overflow-hidden"
        />

        <div className="flex flex-col gap-2.5 min-h-[300px]">
          {currentNote.blocks.map((block, index) => (
            <div key={block.id} className="relative group flex items-start gap-1">
              <div className="flex-1">
                {block.type === 'paragraph' && (
                  <textarea
                    rows={1}
                    value={block.text}
                    placeholder={t('paragraph_placeholder')}
                    onInput={(e) => autoResize(e.currentTarget)}
                    onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                    className="w-full text-[15px] leading-relaxed text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle resize-none overflow-hidden"
                  />
                )}

                {block.type === 'heading' && (
                  <input
                    type="text"
                    value={block.text}
                    placeholder={`${t('heading_placeholder')} (H${block.size})`}
                    onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                    className={`w-full font-semibold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle pt-0.5 ${
                      block.size === 2 ? 'text-lg' : block.size === 3 ? 'text-base' : 'text-sm'
                    }`}
                  />
                )}

                {block.type === 'quote' && (
                  <div className="border-l-2 border-warm-accent pl-3 py-0.5 my-1 flex flex-col gap-1">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('quote_placeholder')}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full text-[15px] italic text-[#4A3828] bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-xs font-medium text-warm-accent bg-transparent border-none focus:outline-none"
                    />
                  </div>
                )}

                {block.type === 'list' && (
                  <div className="flex flex-col gap-1.5 py-1">
                    {block.items.map((item, itemIdx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            triggerHaptic();
                            const newItems = [...block.items];
                            newItems[itemIdx].is_checked = !newItems[itemIdx].is_checked;
                            updateBlock(index, { ...block, items: newItems });
                          }}
                          className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                            item.is_checked ? 'bg-[#5F7466] text-white' : 'border border-warm-subtle bg-transparent'
                          }`}
                        >
                          {item.is_checked && (
                            <span className="material-symbols-outlined text-[13px] font-bold">check</span>
                          )}
                        </button>
                        <input
                          type="text"
                          value={item.text}
                          placeholder={t('task_placeholder')}
                          onChange={(e) => {
                            const newItems = [...block.items];
                            newItems[itemIdx].text = e.target.value;
                            updateBlock(index, { ...block, items: newItems });
                          }}
                          className={`text-sm bg-transparent border-none focus:outline-none flex-1 ${
                            item.is_checked ? 'line-through text-warm-muted' : 'text-warm-text'
                          }`}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        triggerHaptic();
                        const newItems = [
                          ...block.items,
                          { id: `task-${Date.now()}`, text: '', is_checked: false },
                        ];
                        updateBlock(index, { ...block, items: newItems });
                      }}
                      className="text-xs text-warm-accent font-medium self-start flex items-center gap-1 mt-0.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>{t('add_task_item')}</span>
                    </button>
                  </div>
                )}

                {block.type === 'table' && (
                  <div className="flex flex-col gap-1 my-1">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => addTableRow(index)}
                        className="text-[11px] px-2 py-0.5 rounded bg-cream-surface text-warm-accent font-medium physics-bounce"
                      >
                        {t('add_row')}
                      </button>
                      <button
                        onClick={() => addTableColumn(index)}
                        className="text-[11px] px-2 py-0.5 rounded bg-cream-surface text-warm-accent font-medium physics-bounce"
                      >
                        {t('add_column')}
                      </button>
                    </div>
                    <div className="overflow-x-auto py-1">
                      <table className="w-full text-xs text-left border-collapse">
                        <tbody>
                          {block.cells.map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx === 0 ? 'border-b border-cream-divider font-semibold' : ''}>
                              {row.map((col, cIdx) => (
                                <td key={cIdx} className="p-0.5">
                                  <input
                                    type="text"
                                    value={col.text}
                                    placeholder={`[${rIdx + 1},${cIdx + 1}]`}
                                    onChange={(e) => {
                                      const nextCells = block.cells.map((r, ri) =>
                                        r.map((c, ci) => (ri === rIdx && ci === cIdx ? { ...c, text: e.target.value } : c))
                                      );
                                      updateBlock(index, { ...block, cells: nextCells });
                                    }}
                                    className="w-full bg-cream-surface/70 rounded border-none focus:outline-none text-warm-text p-1.5"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {block.type === 'code' && (
                  <div className="bg-cream-surface/70 rounded p-2 my-1 font-code">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('code_placeholder')}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-xs text-warm-text font-code resize-none overflow-hidden"
                    />
                  </div>
                )}

                {block.type === 'math' && (
                  <div className="flex items-center gap-1 py-1 font-code text-xs text-warm-accent">
                    <span>$$</span>
                    <input
                      type="text"
                      value={block.expression}
                      placeholder={t('math_placeholder')}
                      onChange={(e) => updateBlock(index, { ...block, expression: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-warm-text font-code"
                    />
                    <span>$$</span>
                  </div>
                )}

                {block.type === 'details' && (
                  <div className="border-l border-cream-divider pl-3 my-1 flex flex-col gap-1">
                    <input
                      type="text"
                      value={block.summary}
                      placeholder={t('details_summary_placeholder')}
                      onChange={(e) => updateBlock(index, { ...block, summary: e.target.value })}
                      className="text-xs font-semibold text-warm-accent bg-transparent border-none focus:outline-none"
                    />
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('details_content_placeholder')}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="text-xs text-warm-text bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                  </div>
                )}

                {block.type === 'divider' && <div className="w-full h-px bg-cream-divider my-2" />}
              </div>

              <button
                onClick={() => removeBlock(index)}
                className="w-5 h-5 flex items-center justify-center text-warm-subtle hover:text-red-500 pt-0.5"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};