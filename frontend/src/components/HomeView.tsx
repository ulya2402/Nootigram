import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';
import { formatRelativeTime } from '../utils/date';

interface HomeViewProps {
  userName: string;
  notes: NoteItem[];
  topics: TopicItem[];
  onOpenNote: (note: NoteItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onDeleteNote: (id: string) => void;
  onDuplicateNote?: (note: NoteItem) => void;
  onBatchDeleteNotes: (ids: string[]) => void;
  onOpenChannels?: () => void;
}

function extractSnippet(note: NoteItem): string {
  for (const block of note.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) {
      return block.text.replace(/<[^>]*>/g, '').trim();
    }
  }
  return (note.content_raw || '').replace(/<[^>]*>/g, '').trim();
}

function getNoteMedia(note: NoteItem): { url: string; count: number } | null {
  for (const block of note.blocks) {
    if (block.type === 'media' && 'images' in block && Array.isArray(block.images) && block.images.length > 0) {
      const firstImg: any = block.images[0];
      const resolvedUrl = typeof firstImg === 'string' ? firstImg : firstImg?.url;
      if (resolvedUrl) {
        return { url: resolvedUrl, count: block.images.length };
      }
    }
  }
  return null;
}

function inlineHtmlToTelegramMarkdown(rawHtml: string): string {
  if (!rawHtml) return '';
  let text = rawHtml
    .replace(/<tg-time\s+unix="([^"]+)"(?:\s+format="([^"]+)")?[^>]*>([\s\S]*?)<\/tg-time>/gi, (_, unix, fmt, label) => {
      const fmtQuery = fmt ? `&format=${fmt}` : '';
      return `![${label}](tg://time?unix=${unix}${fmtQuery})`;
    })
    .replace(/<tg-emoji\s+emoji-id="([^"]+)"[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '![$2](tg://emoji?id=$1)')
    .replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<(?:b|strong)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**')
    .replace(/<(?:i|em)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*')
    .replace(/<(?:s|strike|del)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:s|strike|del)>/gi, '~~$1~~')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<mark>([\s\S]*?)<\/mark>/gi, '==$1==')
    .replace(/<tg-spoiler>([\s\S]*?)<\/tg-spoiler>/gi, '||$1||')
    .replace(/<tg-math>([\s\S]*?)<\/tg-math>/gi, '$$$1$$')
    .replace(/<div><br\s*[\/]?>\s*<\/div>/gi, '\n')
    .replace(/<div>/gi, '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
  return text.trim();
}

function convertNoteToTelegramMarkdown(note: NoteItem): string {
  const parts: string[] = [];
  if (note.title && note.title.trim()) {
    parts.push(`# ${note.title.trim()}`);
  }
  for (const block of note.blocks) {
    if (block.type === 'heading') {
      const hashes = '#'.repeat(Math.min(6, Math.max(1, block.size || 2)));
      if (block.text.trim()) {
        parts.push(`${hashes}${block.text.trim()}`);
      }
    } else if (block.type === 'paragraph') {
      const md = inlineHtmlToTelegramMarkdown(block.text);
      if (md) {
        parts.push(md);
      }
    } else if (block.type === 'list') {
      const lines = block.items.map((item, idx) => {
        const itemText = inlineHtmlToTelegramMarkdown(item.text);
        if (block.style === 'task') {
          return `- [${item.is_checked ? 'x' : ' '}] ${itemText}`;
        }
        if (block.style === 'ordered') {
          return `${idx + 1}.${itemText}`;
        }
        return `- ${itemText}`;
      });
      if (lines.length > 0) {
        parts.push(lines.join('\n'));
      }
    } else if (block.type === 'quote') {
      const quoteMd = inlineHtmlToTelegramMarkdown(block.text);
      const quoteLines = quoteMd.split('\n').map((l) => `>${l}`);
      if (block.credit && block.credit.trim()) {
        quoteLines.push(`>— ${block.credit.trim()}`);
      }
      parts.push(quoteLines.join('\n'));
    } else if (block.type === 'expandable_quote') {
      const quoteMd = inlineHtmlToTelegramMarkdown(block.text).replace(/\n/g, '<br>');
      const citeTag = block.credit && block.credit.trim() ? `<cite>${block.credit.trim()}</cite>` : '';
      parts.push(`<blockquote expandable>${quoteMd}${citeTag}</blockquote>`);
    } else if (block.type === 'pullquote') {
      const quoteMd = inlineHtmlToTelegramMarkdown(block.text);
      const citeTag = block.credit && block.credit.trim() ? `<cite>${block.credit.trim()}</cite>` : '';
      parts.push(`<aside>${quoteMd}${citeTag}</aside>`);
    } else if (block.type === 'code') {
      const lang = block.language || '';
      parts.push(`\`\`\`${lang}\n${block.text || ''}\n\`\`\``);
    } else if (block.type === 'math') {
      parts.push(`$$${block.expression || ''}$$`);
    } else if (block.type === 'divider') {
      parts.push('---');
    } else if (block.type === 'table' && block.cells.length > 0) {
      const headerRow = block.cells[0];
      const headerLine = `| ${headerRow.map((c) => inlineHtmlToTelegramMarkdown(c.text).replace(/\n/g, ' ')).join(' | ')} |`;
      const alignLine = `| ${headerRow
        .map((c) => (c.align === 'center' ? ':---:' : c.align === 'right' ? '---:' : ':---'))
        .join(' | ')} |`;
      const bodyLines = block.cells
        .slice(1)
        .map((row) => `| ${row.map((c) => inlineHtmlToTelegramMarkdown(c.text).replace(/\n/g, ' ')).join(' | ')} |`);
      parts.push([headerLine, alignLine, ...bodyLines].join('\n'));
    } else if (block.type === 'details') {
      const openAttr = block.is_open ? ' open' : '';
      const summaryMd = inlineHtmlToTelegramMarkdown(block.summary);
      const bodyMd = inlineHtmlToTelegramMarkdown(block.text);
      parts.push(`<details${openAttr}><summary>${summaryMd}</summary>\n\n${bodyMd}\n\n</details>`);
    } else if (block.type === 'media' && block.images && block.images.length > 0) {
      const captionPart = block.caption && block.caption.trim() ? ` "${block.caption.trim().replace(/"/g, '\\"')}"` : '';
      if (block.layout === 'collage' && block.images.length > 1) {
        const imgs = block.images.map((img) => `![](${img.url})`).join('\n');
        parts.push(`<tg-collage>\n\n${imgs}\n\n</tg-collage>`);
      } else if (block.layout === 'slideshow' && block.images.length > 1) {
        const imgs = block.images.map((img) => `![](${img.url})`).join('\n');
        parts.push(`<tg-slideshow>\n\n${imgs}\n\n</tg-slideshow>`);
      } else {
        parts.push(`![](${block.images[0].url}${captionPart})`);
      }
    } else if (block.type === 'audio' || block.type === 'file') {
      const captionPart = block.caption && block.caption.trim() ? ` "${block.caption.trim().replace(/"/g, '\\"')}"` : '';
      parts.push(`![](${block.url}${captionPart})`);
    } else if (block.type === 'button_row' && block.buttons && block.buttons.length > 0) {
      const alignAttr = block.align ? ` align="${block.align}"` : '';
      const btnLines = block.buttons.map((btn) => {
        const styleAttr = btn.style && btn.style !== 'default' ? ` style="${btn.style}"` : '';
        if (btn.type === 'copy_text') {
          return `  <tg-button type="copy_text"${styleAttr} text="${btn.value}">${btn.text}</tg-button>`;
        }
        return `  <tg-button type="url"${styleAttr} url="${btn.value}">${btn.text}</tg-button>`;
      });
      parts.push(`<tg-button-row${alignAttr}>\n${btnLines.join('\n')}\n</tg-button-row>`);
    } else if (block.type === 'footer' && block.text.trim()) {
      parts.push(`<footer>${inlineHtmlToTelegramMarkdown(block.text)}</footer>`);
    }
  }
  return parts.join('\n\n').trim();
}

export const HomeView: React.FC<HomeViewProps> = ({
  userName,
  notes,
  topics,
  onOpenNote,
  onToggleFavorite,
  onDeleteNote,
  onDuplicateNote,
  onBatchDeleteNotes,
  onOpenChannels,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openMenuNoteId, setOpenMenuNoteId] = useState<string | null>(null);
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);
  const [newlyDuplicatedId, setNewlyDuplicatedId] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef<boolean>(true);
  const cardElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const flipCardPositionsRef = useRef<Map<string, number>>(new Map());
  const prevNoteIdsRef = useRef<Set<string>>(new Set(notes.map((n) => n.id)));

  const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const captureCardPositions = () => {
    const positions = new Map<string, number>();
    notes.forEach((n) => {
      const el = cardElementRefs.current[n.id];
      if (el) {
        positions.set(n.id, el.getBoundingClientRect().top);
      }
    });
    flipCardPositionsRef.current = positions;
  };

  useLayoutEffect(() => {
    const currentIds = new Set(notes.map((n) => n.id));
    let addedId: string | null = null;
    for (const n of notes) {
      if (!prevNoteIdsRef.current.has(n.id)) {
        addedId = n.id;
        break;
      }
    }
    prevNoteIdsRef.current = currentIds;

    if (addedId) {
      setNewlyDuplicatedId(addedId);
      const timer = window.setTimeout(() => {
        setNewlyDuplicatedId((prev) => (prev === addedId ? null : prev));
      }, 320);

      if (flipCardPositionsRef.current.size > 0) {
        const prevPositions = flipCardPositionsRef.current;
        flipCardPositionsRef.current = new Map();
        notes.forEach((n) => {
          const oldTop = prevPositions.get(n.id);
          const el = cardElementRefs.current[n.id];
          if (oldTop !== undefined && el) {
            const newTop = el.getBoundingClientRect().top;
            const delta = oldTop - newTop;
            if (Math.abs(delta) > 0.5) {
              el.animate(
                [
                  { transform: `translate3d(0, ${delta}px, 0)` },
                  { transform: 'translate3d(0, 0, 0)' },
                ],
                {
                  duration: 260,
                  easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)',
                }
              );
            }
          }
        });
      }
      return () => clearTimeout(timer);
    }
  }, [notes]);

  useLayoutEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    listRef.current?.animate(
      [
        { opacity: 0.88, transform: 'translate3d(0, 4px, 0) scale(0.995)' },
        { opacity: 1, transform: 'translate3d(0, -1px, 0) scale(1.001)', offset: 0.65 },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      ],
      {
        duration: 200,
        easing: 'cubic-bezier(0.25, 1.15, 0.5, 1)',
      }
    );
  }, [selectedFilter]);

  const handleFilterClick = (topicId: string) => {
    if (selectedFilter === topicId) return;
    triggerHaptic('light');
    setSelectedFilter(topicId);
  };

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (isSelectMode && tg?.BackButton) {
      tg.BackButton.show();
      const handleCancelSelection = () => {
        triggerHaptic('light');
        setIsSelectMode(false);
        setSelectedIds(new Set());
      };
      tg.BackButton.onClick(handleCancelSelection);

      return () => {
        tg.BackButton.offClick(handleCancelSelection);
        tg.BackButton.hide();
      };
    }
  }, [isSelectMode]);

  const handleTouchStart = (noteId: string) => {
    if (isSelectMode) return;
    longPressTimerRef.current = window.setTimeout(() => {
      triggerHaptic('heavy');
      setIsSelectMode(true);
      setSelectedIds(new Set([noteId]));
    }, 450);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const toggleSelect = (noteId: string) => {
    triggerHaptic('light');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const selectAll = () => {
    triggerHaptic('medium');
    const allIds = filteredNotes.map((n) => n.id);
    setSelectedIds(new Set(allIds));
  };

  const cancelSelection = () => {
    triggerHaptic('light');
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    triggerHaptic('medium');
    if (window.confirm(t('batch_delete_confirm', { count: selectedIds.size }))) {
      onBatchDeleteNotes(Array.from(selectedIds));
      setIsSelectMode(false);
      setSelectedIds(new Set());
    }
  };

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      const matchCategory = selectedFilter === 'all' || n.category === selectedFilter;
      const matchSearch =
        searchQuery.trim() === '' ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.blocks.some((b) => 'text' in b && b.text.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCategory && matchSearch;
    });
  }, [notes, selectedFilter, searchQuery]);

  return (
    <div className="flex flex-col w-full px-6 safe-bottom-space">
      {isSelectMode ? (
        <section className="sticky top-0 z-20 bg-[#FAF8F5]/95 -mx-6 px-6 pt-2 pb-3 flex items-center justify-between gap-2 border-b border-cream-divider animate-page-fade shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={cancelSelection}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-cream-surface text-warm-text physics-bounce shrink-0"
            >
              {t('deselect_all')}
            </button>
            <span className="text-xs font-mono text-warm-accent font-semibold truncate">
              {t('selected_count', { count: selectedIds.size })}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={selectAll}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-cream-surface text-warm-text physics-bounce shrink-0"
            >
              {t('select_all')}
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="text-xs font-semibold px-3 py-1 rounded-full bg-red-600 text-white disabled:opacity-40 flex items-center gap-1 physics-bounce shrink-0"
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
              <span>{t('batch_delete')}</span>
            </button>
          </div>
        </section>
      ) : (
        <section className="pt-2 pb-3 flex flex-col gap-1 border-b border-cream-divider/60">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
              {t('my_notes')}
            </span>
            <span className="text-[11px] font-mono text-warm-muted">
              {t('total_notes', { count: notes.length })}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-warm-text tracking-tight leading-snug">
            {t('greeting', { name: userName })}
          </h2>
          <p className="text-xs leading-relaxed text-warm-muted font-normal">
            {t('greeting_sub')}
          </p>
        </section>
      )}

      <section className="py-2.5">
        <div className="relative flex items-center pb-1.5 border-b border-cream-divider focus-within:border-warm-accent transition-colors">
          <input
            className="w-full bg-transparent text-warm-text placeholder:text-warm-subtle text-sm py-1 focus:outline-none"
            placeholder={t('search_placeholder')}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="material-symbols-outlined text-[18px] text-warm-muted">search</span>
        </div>
      </section>

      <section className="py-2 overflow-x-auto -mx-6 px-6 no-scrollbar">
        <div className="flex items-center gap-5 min-w-max border-b border-cream-divider/50 pb-2">
          <button
            onClick={() => handleFilterClick('all')}
            className={`text-sm relative transition-all duration-150 flex items-center gap-1.5 pb-1 active:scale-95 select-none ${
              selectedFilter === 'all' ? 'font-semibold text-warm-text' : 'font-normal text-warm-muted'
            }`}
          >
            <span>{t('filter_all')}</span>
            <span className="text-[11px] font-mono text-warm-muted">{notes.length}</span>
            {selectedFilter === 'all' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-warm-text rounded-full" />
            )}
          </button>
          {topics.map((topic) => {
            const count = notes.filter((n) => n.category === topic.id).length;
            const isActive = selectedFilter === topic.id;
            return (
              <button
                key={topic.id}
                onClick={() => handleFilterClick(topic.id)}
                className={`text-sm relative transition-all duration-150 flex items-center gap-1.5 pb-1 active:scale-95 select-none ${
                  isActive ? 'font-semibold text-warm-text' : 'font-normal text-warm-muted'
                }`}
              >
                <span>{topic.name}</span>
                <span className="text-[11px] font-mono text-warm-muted">{count}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-warm-text rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </section>

        <div ref={listRef} className="flex flex-col will-change-transform">
          {filteredNotes.length === 0 ? (
          <div className="py-16 text-center text-sm text-warm-muted">
            <span className="material-symbols-outlined text-4xl text-warm-subtle block mb-2">edit_note</span>
            {t('empty_notes')}
          </div>
        ) : (
          <section className="flex flex-col">
            {filteredNotes.map((note) => {
              const snippet = extractSnippet(note);
              const categoryObj = topics.find((tItem) => tItem.id === note.category);
              const isSelected = selectedIds.has(note.id);

              return (
                <article
                  key={note.id}
                  ref={(el) => {
                    cardElementRefs.current[note.id] = el;
                  }}
                  onTouchStart={() => handleTouchStart(note.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (openMenuNoteId === note.id) {
                      setOpenMenuNoteId(null);
                      return;
                    }
                    if (isSelectMode) {
                      toggleSelect(note.id);
                    } else {
                      triggerHaptic();
                      onOpenNote(note);
                    }
                  }}
                  className={`py-3.5 border-b border-cream-divider/70 cursor-pointer flex items-start gap-3 select-none ${
                    openMenuNoteId === note.id ? '' : 'physics-bounce'
                  } ${newlyDuplicatedId === note.id ? 'animate-block-enter' : ''} ${
                    isSelected ? 'bg-cream-surface/50 -mx-3 px-3 rounded-lg' : ''
                  }`}
                >
                  {isSelectMode && (
                    <div className="pt-0.5 shrink-0 animate-check-pop">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected
                            ? 'bg-warm-accent border-warm-accent text-white'
                            : 'border-warm-subtle bg-transparent'
                        }`}
                      >
                        {isSelected && (
                          <span className="material-symbols-outlined text-[14px] font-bold">check</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex-1 flex flex-col gap-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-base font-semibold text-warm-text leading-snug truncate">
                        {note.title || t('title_placeholder')}
                      </h4>

                      {!isSelectMode && (
                        <div
                          className="relative flex items-center gap-0.5 shrink-0 -mr-1"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.currentTarget.closest('article')?.classList.remove('physics-bounce');
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            if (openMenuNoteId !== note.id) {
                              e.currentTarget.closest('article')?.classList.add('physics-bounce');
                            }
                          }}
                          onPointerLeave={(e) => {
                            if (openMenuNoteId !== note.id) {
                              e.currentTarget.closest('article')?.classList.add('physics-bounce');
                            }
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            handleTouchEnd();
                            e.currentTarget.closest('article')?.classList.remove('physics-bounce');
                          }}
                          onTouchEnd={(e) => {
                            e.stopPropagation();
                            if (openMenuNoteId !== note.id) {
                              e.currentTarget.closest('article')?.classList.add('physics-bounce');
                            }
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.currentTarget.closest('article')?.classList.remove('physics-bounce');
                          }}
                          onMouseUp={(e) => {
                            e.stopPropagation();
                            if (openMenuNoteId !== note.id) {
                              e.currentTarget.closest('article')?.classList.add('physics-bounce');
                            }
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic();
                              onToggleFavorite(note.id, e);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-warm-accent hover:bg-cream-surface transition-colors"
                          >
                            <span
                              className={`material-symbols-outlined text-[18px] leading-none ${
                                note.is_favorite ? 'text-warm-accent' : ''
                              }`}
                              style={{ fontVariationSettings: note.is_favorite ? "'FILL' 1" : "'FILL' 0" }}
                            >
                              bookmark
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic('medium');
                              if (window.confirm(t('delete_confirm'))) {
                                onDeleteNote(note.id);
                              }
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-red-600 hover:bg-cream-surface transition-colors"
                          >
                            <span className="material-symbols-outlined text-[18px] leading-none">delete</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic('light');
                              setOpenMenuNoteId((prev) => (prev === note.id ? null : note.id));
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-warm-text hover:bg-cream-surface transition-colors"
                          >
                            <span className="material-symbols-outlined text-[18px] leading-none">
                              {copiedNoteId === note.id ? 'check' : 'more_vert'}
                            </span>
                          </button>

                          {openMenuNoteId === note.id && (
                            <>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuNoteId(null);
                                }}
                                className="fixed inset-0 z-30"
                              />
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1 w-44 bg-[#FAF8F5] border border-cream-divider rounded-2xl shadow-md p-1 z-40 animate-toc-down flex flex-col gap-0.5"
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuNoteId(null);
                                    captureCardPositions();
                                    onDuplicateNote?.(note);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-warm-text hover:bg-cream-surface active:opacity-70 transition-colors text-left"
                                >
                                  <span className="material-symbols-outlined text-[15px] text-warm-accent">content_copy</span>
                                  <span>Duplicate</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    triggerHaptic('medium');
                                    const mdText = convertNoteToTelegramMarkdown(note);
                                    try {
                                      await navigator.clipboard.writeText(mdText);
                                      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                                      setCopiedNoteId(note.id);
                                      setTimeout(() => setCopiedNoteId(null), 1800);
                                    } catch (err) {
                                      console.error(`CLIPBOARD_COPY_FAILED: ${(err as Error).message}`);
                                    }
                                    setOpenMenuNoteId(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-warm-text hover:bg-cream-surface active:opacity-70 transition-colors text-left"
                                >
                                  <span className="material-symbols-outlined text-[15px] text-warm-accent">code</span>
                                  <span>Copy to Markdown</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {snippet && (
                          <p className="text-sm text-warm-muted leading-relaxed line-clamp-2">
                            {snippet}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-warm-muted">
                          <span className="font-medium text-warm-accent uppercase text-[10px]">
                            {categoryObj ? categoryObj.name : note.category}
                          </span>
                          <span>•</span>
                          <span className="text-[11px] font-mono text-warm-subtle">
                            {formatRelativeTime(note.updated_at_str)}
                          </span>
                        </div>
                      </div>
                      {(() => {
                        const media = getNoteMedia(note);
                        if (!media) return null;
                        return (
                          <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-cream-surface border border-cream-divider/80">
                            <img
                              src={media.url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            {media.count > 1 && (
                              <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded bg-[#24201D]/75 text-[9px] font-mono text-white leading-none">
                                {media.count}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};