import React, { useState } from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';
import { formatRelativeTime } from '../utils/date';

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
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    topics.forEach((tp) => {
      init[tp.id] = true;
    });
    return init;
  });

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const toggleFolder = (id: string) => {
    triggerHaptic('light');
    setOpenFolders((prev) => ({ ...prev, [id]: !prev[id] }));
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
      <section className="pt-2 pb-3 border-b border-cream-divider flex items-center justify-between">
        <div>
          <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
            {t('tree_root')}
          </span>
          <h2 className="text-xl font-semibold text-warm-text tracking-tight mt-0.5">
            {t('notebooks_title')}
          </h2>
          <p className="text-xs text-warm-muted mt-0.5">
            {t('total_folders', { count: topics.length })} • {t('total_notes', { count: notes.length })}
          </p>
        </div>

        <button
          onClick={() => {
            triggerHaptic();
            setIsAdding(!isAdding);
          }}
          className="px-3 py-1.5 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-semibold flex items-center gap-1 physics-bounce"
        >
          <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
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

      <div className="flex flex-col py-3 select-none">
        {topics.map((cat) => {
          const categoryNotes = notes.filter((n) => n.category === cat.id);
          const isOpen = Boolean(openFolders[cat.id]);

          return (
            <div key={cat.id} className="flex flex-col py-1">
              <div
                onClick={() => toggleFolder(cat.id)}
                className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-cream-surface/80 cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="material-symbols-outlined text-[18px] text-warm-subtle transition-transform duration-200"
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    chevron_right
                  </span>
                  <span className="material-symbols-outlined text-[19px] text-warm-accent">
                    {isOpen ? 'folder_open' : 'folder'}
                  </span>
                  <span className="text-sm font-semibold text-warm-text">{cat.name}</span>
                  <span className="text-[10px] font-mono text-warm-muted bg-cream-divider/50 px-1.5 py-0.2 rounded-full">
                    {categoryNotes.length}
                  </span>
                </div>

                {!cat.is_default && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHaptic('medium');
                      if (window.confirm(t('delete_topic_confirm'))) {
                        onDeleteTopic(cat.id);
                      }
                    }}
                    className="text-warm-subtle hover:text-red-600 p-1 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="ml-5 pl-3 border-l border-cream-divider flex flex-col gap-1 py-1 animate-page-fade">
                  {categoryNotes.length > 0 ? (
                    categoryNotes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => {
                          triggerHaptic();
                          onOpenNote(note);
                        }}
                        className="py-1.5 px-2 rounded flex items-center justify-between cursor-pointer hover:bg-cream-surface/60 transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="material-symbols-outlined text-[16px] text-warm-subtle group-hover:text-warm-accent shrink-0">
                            description
                          </span>
                          <span className="text-xs text-warm-text group-hover:text-warm-accent truncate font-normal">
                            {note.title || t('title_placeholder')}
                          </span>
                        </div>
                        <span className="text-[10px] text-warm-subtle shrink-0 font-mono">
                          {formatRelativeTime(note.updated_at_str)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-warm-subtle italic py-1 pl-2">
                      {t('topics_empty')}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};