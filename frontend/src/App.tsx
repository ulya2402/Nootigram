import React, { useEffect, useState, useTransition, useRef, useCallback } from 'react';
import { HomeView } from './components/HomeView';
import { NotebooksView } from './components/NotebooksView';
import { FavoritesView } from './components/FavoritesView';
import { EditorView } from './components/EditorView';
import { NoteItem, TopicItem } from './types';
import { fetchBootstrap, syncNotesBatch, deleteNoteApi, deleteNotesBatchApi, createTopicApi, deleteTopicApi } from './services/api';
import { setLanguage, t, subscribeLanguage } from './services/i18n';
let isTelegramBound = false;

const DEFAULT_TOPICS: TopicItem[] = [
  { id: 'ideas', name: 'Ideas', is_default: true },
  { id: 'projects', name: 'Projects', is_default: true },
];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'notes' | 'notebooks' | 'favorites'>('notes');
  const [activeView, setActiveView] = useState<'list' | 'editor'>('list');
  const [activeNote, setActiveNote] = useState<NoteItem | null>(null);
  const [, setCurrentLang] = useState<string>(() => localStorage.getItem('notigram_lang') || 'en');

  useEffect(() => {
    return subscribeLanguage((lang: string) => {
      setCurrentLang(lang);
    });
  }, []);
  const [notes, setNotes] = useState<NoteItem[]>(() => {
    const cached = localStorage.getItem('notigram_user_notes');
    return cached ? (JSON.parse(cached) as NoteItem[]) : [];
  });
  const [topics, setTopics] = useState<TopicItem[]>(() => {
    const cached = localStorage.getItem('notigram_user_topics');
    return cached ? (JSON.parse(cached) as TopicItem[]) : DEFAULT_TOPICS;
  });
  const [userName, setUserName] = useState<string>('Teman');
  const [userPhoto, setUserPhoto] = useState<string | undefined>(undefined);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const debounceTimerRef = useRef<number | null>(null);
  const pendingNotesRef = useRef<Map<string, NoteItem>>(new Map());

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const flushPendingSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingNotesRef.current.size > 0) {
      const itemsToSync = Array.from(pendingNotesRef.current.values());
      pendingNotesRef.current.clear();
      syncNotesBatch(itemsToSync);
    }
  }, []);

  useEffect(() => {
    const handleViewport = () => {
      if (window.visualViewport) {
        const offset = window.innerHeight - window.visualViewport.height;
        document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, offset)}px`);
      }
    };
    window.visualViewport?.addEventListener('resize', handleViewport);
    window.visualViewport?.addEventListener('scroll', handleViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewport);
      window.visualViewport?.removeEventListener('scroll', handleViewport);
    };
  }, []);

  useEffect(() => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg && !isTelegramBound) {
        isTelegramBound = true;
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
        tg.disableVerticalSwipes();
        tg.setHeaderColor('#FAF8F5');
        tg.setBackgroundColor('#FAF8F5');
        const user = tg.initDataUnsafe?.user;
        if (user) {
          setUserName(user.first_name || t('default_user_name'));
          setUserPhoto(user.photo_url);
        }
        const applyInsets = () => {
          const root = document.documentElement.style;
          const sTop = tg.safeAreaInset?.top ?? 0;
          const sBottom = tg.safeAreaInset?.bottom ?? 0;
          const cTop = tg.contentSafeAreaInset?.top ?? 0;
          const cBottom = tg.contentSafeAreaInset?.bottom ?? 0;
          root.setProperty('--tg-safe-top', `${sTop}px`);
          root.setProperty('--tg-safe-bottom', `${sBottom}px`);
          root.setProperty('--tg-content-top', `${cTop}px`);
          root.setProperty('--tg-content-bottom', `${cBottom}px`);
        };
        applyInsets();
        tg.onEvent('safeAreaChanged', applyInsets);
        tg.onEvent('contentSafeAreaChanged', applyInsets);
      }
    } catch (error) {
      console.error('TELEGRAM_INITIALIZE_FAILED', error);
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingSync();
      }
    };
    const handlePageHide = () => {
      flushPendingSync();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushPendingSync]);

  useEffect(() => {
    fetchBootstrap().then((res) => {
      setLanguage(res.language_code || 'en');
      if (res.topics && res.topics.length > 0) {
        setTopics(res.topics);
        localStorage.setItem('notigram_user_topics', JSON.stringify(res.topics));
      }
      if (res.notes) {
        setNotes((currentLocalNotes) => {
          const remoteIds = new Set(res.notes.map((n) => n.id));
          const unsyncedNotes = currentLocalNotes.filter((n) => !remoteIds.has(n.id));
          const mergedNotes = [...unsyncedNotes, ...res.notes];

          localStorage.setItem('notigram_user_notes', JSON.stringify(mergedNotes));

          if (unsyncedNotes.length > 0) {
            syncNotesBatch(unsyncedNotes);
          }
          return mergedNotes;
        });
      }
    });
  }, []);

  const handleOpenNote = (note: NoteItem) => {
    flushPendingSync();
    startTransition(() => {
      setActiveNote(note);
      setActiveView('editor');
    });
  };

  const handleCreateNote = () => {
    flushPendingSync();
    const newNote: NoteItem = {
      id: `note-${Date.now()}`,
      category: topics[0]?.id || 'ideas',
      title: '',
      blocks: [
        {
          id: `p-${Date.now()}`,
          type: 'paragraph',
          text: '',
        },
      ],
      is_pinned: false,
      is_favorite: false,
      updated_at_str: new Date().toISOString(),
    };
    startTransition(() => {
      setActiveNote(newNote);
      setActiveView('editor');
    });
  };

  const handleSaveNote = (updated: NoteItem) => {
    const exists = notes.some((n) => n.id === updated.id);
    const nextNotes = exists ? notes.map((n) => (n.id === updated.id ? updated : n)) : [updated, ...notes];
    setNotes(nextNotes);
    localStorage.setItem('notigram_user_notes', JSON.stringify(nextNotes));

    pendingNotesRef.current.set(updated.id, updated);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      flushPendingSync();
    }, 1200);
  };

  const handleDeleteNote = (id: string) => {
    pendingNotesRef.current.delete(id);
    const nextNotes = notes.filter((n) => n.id !== id);
    setNotes(nextNotes);
    localStorage.setItem('notigram_user_notes', JSON.stringify(nextNotes));
    if (activeNote?.id === id) {
      setActiveView('list');
      setActiveNote(null);
    }
    deleteNoteApi(id);
  };

  const handleBatchDeleteNotes = (ids: string[]) => {
    ids.forEach((id) => pendingNotesRef.current.delete(id));
    const nextNotes = notes.filter((n) => !ids.includes(n.id));
    setNotes(nextNotes);
    localStorage.setItem('notigram_user_notes', JSON.stringify(nextNotes));
    deleteNotesBatchApi(ids);
  };

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextNotes = notes.map((n) => (n.id === id ? { ...n, is_favorite: !n.is_favorite } : n));
    setNotes(nextNotes);
    localStorage.setItem('notigram_user_notes', JSON.stringify(nextNotes));
    const target = nextNotes.find((n) => n.id === id);
    if (target) {
      pendingNotesRef.current.set(target.id, target);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        flushPendingSync();
      }, 1000);
    }
  };

  const handleAddTopic = (name: string) => {
    const newTopic: TopicItem = { id: `top-${Date.now()}`, name, is_default: false };
    const nextTopics = [...topics, newTopic];
    setTopics(nextTopics);
    localStorage.setItem('notigram_user_topics', JSON.stringify(nextTopics));
    createTopicApi(newTopic);
  };

  const handleDeleteTopic = (id: string) => {
    const nextTopics = topics.filter((tItem) => tItem.id !== id);
    setTopics(nextTopics);
    localStorage.setItem('notigram_user_topics', JSON.stringify(nextTopics));
    deleteTopicApi(id);
  };

  return (
    <div ref={rootRef} className="app-container">
      {activeView === 'list' && (
        <header className="safe-header-box bg-[#FAF8F5] border-b border-cream-divider/60 max-w-[420px] w-full mx-auto shrink-0 z-20">
          <div className="px-6 pb-2 flex items-center justify-between">
            <h1 className="text-sm font-semibold tracking-tight text-warm-text">
              {activeTab === 'notes'
                ? t('notes_title')
                : activeTab === 'notebooks'
                ? t('notebooks_title')
                : t('favorites_title')}
            </h1>
            <div className="w-7 h-7 rounded-full bg-cream-surface text-warm-text font-semibold text-xs flex items-center justify-center border border-cream-divider overflow-hidden">
              {userPhoto ? (
                <img src={userPhoto} alt={userName} className="w-full h-full object-cover" />
              ) : (
                <span>{userName.charAt(0).toUpperCase()}</span>
              )}
            </div>
          </div>
        </header>
      )}

      <div className="scroll-container">
        {activeView === 'editor' && activeNote ? (
          <EditorView
            note={activeNote}
            topics={topics}
            onBack={() => {
              flushPendingSync();
              triggerHaptic();
              setActiveView('list');
            }}
            onSave={handleSaveNote}
            onDelete={handleDeleteNote}
          />
        ) : (
          <>
            {activeTab === 'notes' && (
              <HomeView
                userName={userName}
                notes={notes}
                topics={topics}
                onOpenNote={handleOpenNote}
                onToggleFavorite={handleToggleFavorite}
                onDeleteNote={handleDeleteNote}
                onBatchDeleteNotes={handleBatchDeleteNotes}
              />
            )}
            {activeTab === 'notebooks' && (
              <NotebooksView
                notes={notes}
                topics={topics}
                onOpenNote={handleOpenNote}
                onAddTopic={handleAddTopic}
                onDeleteTopic={handleDeleteTopic}
              />
            )}
            {activeTab === 'favorites' && (
              <FavoritesView
                notes={notes}
                topics={topics}
                onOpenNote={handleOpenNote}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          </>
        )}
      </div>

      {activeView === 'list' && activeTab === 'notes' && (
        <div className="fixed bottom-20 right-6 z-40 max-w-[420px] pointer-events-auto">
          <button
            onClick={() => {
              triggerHaptic('medium');
              handleCreateNote();
            }}
            className="flex items-center gap-1.5 pl-4 pr-5 py-2.5 rounded-full bg-warm-text text-[#FAF8F5] shadow-lg physics-bounce"
          >
            <span className="material-symbols-outlined text-[19px]">edit</span>
            <span className="text-xs font-semibold tracking-wide">{t('write')}</span>
          </button>
        </div>
      )}

      {activeView === 'list' && (
        <nav className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-6 pointer-events-none max-w-[420px] mx-auto animate-page-fade">
          <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-full bg-[#FAF8F5] border border-cream-divider shadow-[0_8px_24px_rgba(40,30,20,0.08)]">
            <button
              onClick={() => {
                triggerHaptic();
                setActiveTab('notes');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full min-h-[38px] transition-all duration-200 physics-bounce ${
                activeTab === 'notes' ? 'bg-warm-text text-[#FAF8F5]' : 'text-warm-muted'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">note_stack</span>
              {activeTab === 'notes' && <span className="text-xs font-semibold">{t('notes_title')}</span>}
            </button>
            <button
              onClick={() => {
                triggerHaptic();
                setActiveTab('notebooks');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full min-h-[38px] transition-all duration-200 physics-bounce ${
                activeTab === 'notebooks' ? 'bg-warm-text text-[#FAF8F5]' : 'text-warm-muted'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">folder</span>
              {activeTab === 'notebooks' && <span className="text-xs font-medium">{t('notebooks_title')}</span>}
            </button>
            <button
              onClick={() => {
                triggerHaptic();
                setActiveTab('favorites');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full min-h-[38px] transition-all duration-200 physics-bounce ${
                activeTab === 'favorites' ? 'bg-warm-text text-[#FAF8F5]' : 'text-warm-muted'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">bookmark</span>
              {activeTab === 'favorites' && <span className="text-xs font-medium">{t('favorites_title')}</span>}
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};