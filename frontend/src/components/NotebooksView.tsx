import React, { useState } from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';

interface NotebooksViewProps {
  notes: NoteItem[];
  topics: TopicItem[];
  onOpenNote: (note: NoteItem) => void;
  onAddTopic: (name: string) => void;
  onDeleteTopic: (id: string) => void;
}

export const NotebooksView: React.FC<NotebooksViewProps> = ({
  notes,
  topics,
  onOpenNote,
  onAddTopic,
  onDeleteTopic,
}) => {
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [newTopicName, setNewTopicName] = useState<string>('');

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopicName.trim()) return;
    triggerHaptic('medium');
    onAddTopic(newTopicName.trim());
    setNewTopicName('');
    setIsAdding(false);
  };

  return (
    <div className="flex flex-col w-full px-6 safe-bottom-space animate-page-fade">
      <section className="pt-2 pb-4 border-b border-cream-divider flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-warm-text tracking-tight">
            {t('notebooks_title')}
          </h2>
          <p className="text-xs text-warm-muted mt-0.5">
            {t('total_notes', { count: notes.length })}
          </p>
        </div>

        <button
          onClick={() => {
            triggerHaptic();
            setIsAdding(!isAdding);
          }}
          className="px-3 py-1.5 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-semibold flex items-center gap-1 physics-bounce"
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
          <span>{t('add_topic')}</span>
        </button>
      </section>

      {isAdding && (
        <form onSubmit={handleCreate} className="py-3 flex items-center gap-2 border-b border-cream-divider">
          <input
            type="text"
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            placeholder={t('new_topic_placeholder')}
            autoFocus
            className="flex-1 bg-cream-surface rounded px-3 py-1.5 text-xs text-warm-text border-none focus:outline-none"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-warm-accent text-white text-xs font-medium physics-bounce"
          >
            {t('create_topic')}
          </button>
        </form>
      )}

      <div className="flex flex-col divide-y divide-cream-divider">
        {topics.map((cat) => {
          const categoryNotes = notes.filter((n) => n.category === cat.id);

          return (
            <div key={cat.id} className="py-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-warm-text">{cat.name}</h3>
                  <span className="text-[11px] font-mono text-warm-muted">({categoryNotes.length})</span>
                </div>

                {!cat.is_default && (
                  <button
                    onClick={() => {
                      triggerHaptic('medium');
                      if (window.confirm(t('delete_topic_confirm'))) {
                        onDeleteTopic(cat.id);
                      }
                    }}
                    className="text-warm-subtle hover:text-red-600 physics-bounce p-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                )}
              </div>

              {categoryNotes.length > 0 ? (
                <div className="flex flex-col gap-1 pt-1">
                  {categoryNotes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => {
                        triggerHaptic();
                        onOpenNote(note);
                      }}
                      className="py-1 flex items-center justify-between cursor-pointer physics-bounce group"
                    >
                      <span className="text-xs text-warm-text group-hover:text-warm-accent transition-colors truncate pr-3 font-normal">
                        {note.title || t('title_placeholder')}
                      </span>
                      <span className="text-[10px] text-warm-subtle shrink-0 font-mono">
                        {note.updated_at_str}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-warm-subtle italic pt-0.5">{t('topics_empty')}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};