import React from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';

interface FavoritesViewProps {
  notes: NoteItem[];
  topics: TopicItem[];
  onOpenNote: (note: NoteItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
}

function getPreviewText(note: NoteItem): string {
  for (const block of note.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) {
      return block.text;
    }
  }
  return note.content_raw || '';
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  notes,
  topics,
  onOpenNote,
  onToggleFavorite,
}) => {
  const favoriteNotes = notes.filter((n) => n.is_favorite);

  return (
    <div className="flex flex-col w-full px-6 safe-bottom-space animate-page-fade">
      <section className="pt-2 pb-4 text-center border-b border-cream-divider">
        <h2 className="text-xl font-semibold text-warm-text tracking-tight">
          {t('favorites_title')}
        </h2>
        <p className="text-xs text-warm-muted mt-0.5">
          {t('total_notes', { count: favoriteNotes.length })}
        </p>
      </section>

      {favoriteNotes.length === 0 ? (
        <div className="py-20 text-center text-sm text-warm-muted">
          <span className="material-symbols-outlined text-4xl text-warm-subtle block mb-2">bookmark_border</span>
          {t('empty_favorites')}
        </div>
      ) : (
        <div className="flex flex-col">
          {favoriteNotes.map((note) => {
            const previewText = getPreviewText(note);
            const categoryObj = topics.find((tItem) => tItem.id === note.category);

            return (
              <article
                key={note.id}
                onClick={() => onOpenNote(note)}
                className="py-3.5 border-b border-cream-divider/70 cursor-pointer physics-bounce flex flex-col gap-1"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-base font-semibold text-warm-text leading-snug">
                    {note.title || t('title_placeholder')}
                  </h4>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => onToggleFavorite(note.id, e)}
                      className="text-warm-accent"
                    >
                      <span className="material-symbols-outlined text-[18px]">bookmark</span>
                    </button>
                    <span className="text-xs text-warm-subtle">{note.updated_at_str}</span>
                  </div>
                </div>
                {previewText && (
                  <p className="text-sm text-warm-muted leading-relaxed line-clamp-2">
                    {previewText}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-0.5 text-xs text-warm-muted">
                  <span className="font-medium text-warm-accent uppercase text-[11px]">
                    {categoryObj ? categoryObj.name : note.category}
                  </span>
                  <span>•</span>
                  <span>{note.blocks.length} blok</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};