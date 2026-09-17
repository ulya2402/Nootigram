import React from 'react';
import { NoteItem, TopicItem } from '../types';
import { t } from '../services/i18n';
import { formatRelativeTime } from '../utils/date';

interface FavoritesViewProps {
  notes: NoteItem[];
  topics: TopicItem[];
  onOpenNote: (note: NoteItem) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
}

function getPreviewText(note: NoteItem): string {
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

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  notes,
  topics,
  onOpenNote,
  onToggleFavorite,
}) => {
  const favoriteNotes = notes.filter((n) => n.is_favorite);

  return (
    <div className="flex flex-col w-full px-6 safe-bottom-space animate-page-fade">
      <section className="pt-2 pb-3 border-b border-cream-divider flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
          {t('favorites_title')}
        </span>
        <h2 className="text-xl font-semibold text-warm-text tracking-tight">
          {t('favorites_heading')}
        </h2>
        <p className="text-xs text-warm-muted">
          {t('favorites_sub', { count: favoriteNotes.length })}
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
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-semibold text-warm-text leading-snug truncate">
                    {note.title || t('title_placeholder')}
                  </h4>
                  <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                    <button
                      type="button"
                      onClick={(e) => onToggleFavorite(note.id, e)}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-warm-accent hover:bg-cream-surface transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
                        bookmark
                      </span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {previewText && (
                      <p className="text-sm text-warm-muted leading-relaxed line-clamp-2">
                        {previewText}
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
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};