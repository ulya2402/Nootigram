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
  onBatchDeleteNotes: (ids: string[]) => void;
}

function extractSnippet(note: NoteItem): string {
  for (const block of note.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) {
      return block.text.replace(/<[^>]*>/g, '').trim();
    }
  }
  return (note.content_raw || '').replace(/<[^>]*>/g, '').trim();
}

export const HomeView: React.FC<HomeViewProps> = ({
  userName,
  notes,
  topics,
  onOpenNote,
  onToggleFavorite,
  onDeleteNote,
  onBatchDeleteNotes,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const longPressTimerRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef<boolean>(true);

  const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

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
        <section className="pt-2 pb-3 flex items-center justify-between border-b border-cream-divider animate-page-fade">
          <div className="flex items-center gap-2">
            <button
              onClick={cancelSelection}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-cream-surface text-warm-text physics-bounce"
            >
              {t('deselect_all')}
            </button>
            <span className="text-xs font-mono text-warm-accent font-semibold">
              {t('selected_count', { count: selectedIds.size })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="text-xs font-semibold px-2.5 py-1 rounded-full bg-cream-surface text-warm-text physics-bounce"
            >
              {t('select_all')}
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="text-xs font-semibold px-3 py-1 rounded-full bg-red-600 text-white disabled:opacity-40 flex items-center gap-1 physics-bounce"
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
                  onTouchStart={() => handleTouchStart(note.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (isSelectMode) {
                      toggleSelect(note.id);
                    } else {
                      triggerHaptic();
                      onOpenNote(note);
                    }
                  }}
                  className={`py-3.5 border-b border-cream-divider/70 cursor-pointer physics-bounce flex items-start gap-3 select-none ${
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
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="text-base font-semibold text-warm-text leading-snug truncate">
                        {note.title || t('title_placeholder')}
                      </h4>
                      {!isSelectMode && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic();
                              onToggleFavorite(note.id, e);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-warm-accent hover:bg-cream-surface transition-colors"
                          >
                            <span
                              className={`material-symbols-outlined text-[18px] ${
                                note.is_favorite ? 'text-warm-accent' : ''
                              }`}
                              style={{ fontVariationSettings: note.is_favorite ? "'FILL' 1" : "'FILL' 0" }}
                            >
                              bookmark
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic('medium');
                              if (window.confirm(t('delete_confirm'))) {
                                onDeleteNote(note.id);
                              }
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-red-600 hover:bg-cream-surface transition-colors"
                          >
                            <span className="material-symbols-outlined text-[17px]">delete</span>
                          </button>
                        </div>
                      )}
                    </div>
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
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};