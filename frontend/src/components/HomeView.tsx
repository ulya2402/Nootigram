import React, { useState, useMemo, useRef } from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';

interface HomeViewProps {
  userName: string;
  userPhoto?: string;
  notes: NoteItem[];
  topics: TopicItem[];
  onOpenNote: (note: NoteItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onDeleteNote: (id: string) => void;
}

function extractSnippet(note: NoteItem): string {
  for (const block of note.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) {
      return block.text;
    }
  }
  return note.content_raw || '';
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr || dateStr === 'Baru saja' || dateStr === 'Recently') {
    return t('time_just_now');
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return dateStr;
  }

  const diffMs = Date.now() - parsed.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 2) return t('time_just_now');
  if (diffMin < 60) return t('time_mins_ago', { count: diffMin });
  if (diffHour < 24) return t('time_hours_ago', { count: diffHour });
  if (diffDay === 1) return t('time_yesterday');

  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const HomeView: React.FC<HomeViewProps> = ({
  userName,
  userPhoto,
  notes,
  topics,
  onOpenNote,
  onToggleFavorite,
  onDeleteNote,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionSheetNote, setActionSheetNote] = useState<NoteItem | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const handleTouchStart = (note: NoteItem) => {
    longPressTimerRef.current = window.setTimeout(() => {
      triggerHaptic('heavy');
      setActionSheetNote(note);
    }, 550);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
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
      <section className="pt-2 pb-3 flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
            {t('my_notes')}
          </span>
          <h2 className="text-xl font-semibold text-warm-text tracking-tight leading-snug">
            {t('greeting', { name: userName })}
          </h2>
          <p className="text-xs text-warm-muted line-clamp-1">{t('greeting_sub')}</p>
        </div>

        <div className="w-10 h-10 rounded-full border border-cream-divider overflow-hidden flex items-center justify-center bg-cream-surface shrink-0">
          {userPhoto ? (
            <img src={userPhoto} alt={userName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-warm-text">{userName.charAt(0).toUpperCase()}</span>
          )}
        </div>
      </section>

      <section className="py-2">
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

      <section className="py-2.5 overflow-x-auto -mx-6 px-6 no-scrollbar">
        <div className="flex items-center gap-5 min-w-max border-b border-cream-divider/50 pb-2">
          <button
            onClick={() => {
              triggerHaptic();
              setSelectedFilter('all');
            }}
            className={`text-sm relative transition-colors flex items-center gap-1.5 pb-1 ${
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
                onClick={() => {
                  triggerHaptic();
                  setSelectedFilter(topic.id);
                }}
                className={`text-sm relative transition-colors flex items-center gap-1.5 pb-1 ${
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

      <div key={selectedFilter} className="flex flex-col animate-page-fade">
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

              return (
                <article
                  key={note.id}
                  onTouchStart={() => handleTouchStart(note)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  onClick={() => {
                    triggerHaptic();
                    onOpenNote(note);
                  }}
                  className="py-3.5 border-b border-cream-divider/70 cursor-pointer physics-bounce flex flex-col gap-1 select-none"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-base font-semibold text-warm-text leading-snug">
                      {note.title || t('title_placeholder')}
                    </h4>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerHaptic();
                          onToggleFavorite(note.id, e);
                        }}
                        className="text-warm-subtle hover:text-warm-accent p-1"
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
                        className="text-warm-subtle hover:text-red-600 p-1"
                      >
                        <span className="material-symbols-outlined text-[17px]">delete</span>
                      </button>
                    </div>
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
                </article>
              );
            })}
          </section>
        )}
      </div>

      {actionSheetNote && (
        <div
          onClick={() => setActionSheetNote(null)}
          className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center animate-page-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[420px] bg-[#FAF8F5] rounded-t-2xl p-5 flex flex-col gap-2.5 pb-8 shadow-2xl"
          >
            <div className="w-10 h-1 rounded-full bg-cream-divider mx-auto mb-1" />
            <h3 className="text-sm font-semibold text-warm-text truncate px-1">
              {actionSheetNote.title || t('title_placeholder')}
            </h3>

            <button
              onClick={() => {
                const target = actionSheetNote;
                setActionSheetNote(null);
                onOpenNote(target);
              }}
              className="w-full py-3 rounded-xl bg-cream-surface flex items-center justify-center gap-2 text-sm font-medium text-warm-text physics-bounce"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span>{t('action_open')}</span>
            </button>

            <button
              onClick={(e) => {
                const target = actionSheetNote;
                setActionSheetNote(null);
                onToggleFavorite(target.id, e);
              }}
              className="w-full py-3 rounded-xl bg-cream-surface flex items-center justify-center gap-2 text-sm font-medium text-warm-text physics-bounce"
            >
              <span className="material-symbols-outlined text-[18px]">bookmark</span>
              <span>{actionSheetNote.is_favorite ? t('action_unfavorite') : t('action_favorite')}</span>
            </button>

            <button
              onClick={() => {
                const targetId = actionSheetNote.id;
                setActionSheetNote(null);
                if (window.confirm(t('delete_confirm'))) {
                  onDeleteNote(targetId);
                }
              }}
              className="w-full py-3 rounded-xl bg-red-50 text-red-600 flex items-center justify-center gap-2 text-sm font-medium physics-bounce"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span>{t('delete_note')}</span>
            </button>

            <button
              onClick={() => setActionSheetNote(null)}
              className="w-full py-2.5 text-center text-xs text-warm-muted font-medium mt-1"
            >
              {t('action_cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};