import React, { useState, useEffect, useRef } from 'react';
import { ChannelItem } from '../types';
import { t } from '../services/i18n';
import { deleteChannelApi } from '../services/api';

interface ChannelsViewProps {
  channels: ChannelItem[];
  botUsername: string;
  onRefresh: () => Promise<ChannelItem[]>;
  onChannelsUpdated: (channels: ChannelItem[]) => void;
  onBack: () => void;
}

export const ChannelsView: React.FC<ChannelsViewProps> = ({
  channels,
  botUsername,
  onRefresh,
  onChannelsUpdated,
}) => {
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const lastCheckRef = useRef<number>(0);

  useEffect(() => {
    const prevCount = channels.length;
    const checkUpdate = async () => {
      const now = Date.now();
      if (now - lastCheckRef.current < 2000) return;
      lastCheckRef.current = now;
      const updated = await onRefresh();
      if (updated.length > prevCount) {
        triggerHaptic('medium');
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
        setAlertNotice(t('channel_connected_alert'));
        setTimeout(() => setAlertNotice(null), 3500);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkUpdate();
      }
    };
    window.addEventListener('focus', checkUpdate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', checkUpdate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [channels.length, onRefresh]);

  const handleConnectChannel = () => {
    triggerHaptic('medium');
    if (channels.length >= 5) {
      setAlertNotice(t('channel_limit_reached'));
      setTimeout(() => setAlertNotice(null), 3000);
      return;
    }
    const adminRights = 'change_info+post_messages+edit_messages+delete_messages+invite_users+manage_chat+manage_video_chats+post_stories+edit_stories+delete_stories';
    const link = `https://t.me/${botUsername}?startchannel=true&admin=${adminRights}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(link);
    } else {
      window.open(link, '_blank');
    }
  };

  const handleDelete = async (id: string) => {
    triggerHaptic('medium');
    if (!window.confirm(t('delete_channel_confirm'))) return;
    const next = channels.filter((c) => c.id !== id);
    onChannelsUpdated(next);
    await deleteChannelApi(id);
  };

  return (
    <div className="flex flex-col w-full px-6 safe-bottom-space animate-page-fade">
      <section className="pt-3 pb-4 border-b border-cream-divider flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold text-warm-accent tracking-wider uppercase">
              {t('channels_title')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cream-surface border border-cream-divider text-warm-muted">
              {channels.length}/5
            </span>
          </div>
          <button
            type="button"
            onClick={handleConnectChannel}
            disabled={channels.length >= 5}
            className="h-8 px-3.5 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-semibold flex items-center gap-1.5 physics-bounce disabled:opacity-40 shrink-0 select-none"
          >
            <span className="material-symbols-outlined text-[15px] leading-none">add</span>
            <span>{t('add_channel')}</span>
          </button>
        </div>
        <p className="text-xs text-warm-muted leading-relaxed">
          {t('channels_sub')}
        </p>
      </section>

      {alertNotice && (
        <div className="my-3 p-3 rounded-xl bg-cream-surface border border-warm-accent/30 text-xs text-warm-accent font-medium flex items-center justify-between gap-2 animate-page-fade">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[16px] shrink-0">check_circle</span>
            <span className="truncate">{alertNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setAlertNotice(null)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-warm-muted hover:text-warm-text shrink-0"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="my-8 py-12 px-6 rounded-2xl bg-cream-surface/30 border border-cream-divider flex flex-col items-center justify-center text-center gap-2 select-none animate-page-fade">
          <div className="w-10 h-10 rounded-xl bg-cream-surface border border-cream-divider flex items-center justify-center text-warm-accent mb-1">
            <span className="material-symbols-outlined text-xl leading-none">campaign</span>
          </div>
          <span className="text-xs font-semibold text-warm-text">{t('empty_channels')}</span>
          <p className="text-[11px] text-warm-muted max-w-[260px] leading-relaxed">
            {t('channels_sub')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-4">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="p-3.5 rounded-xl bg-cream-surface/60 border border-cream-divider/80 flex items-center justify-between gap-3 group transition-colors select-none hover:bg-cream-surface"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#FAF8F5] border border-cream-divider flex items-center justify-center shrink-0 text-warm-accent">
                  <span className="material-symbols-outlined text-[18px] leading-none">campaign</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-xs font-semibold text-warm-text truncate leading-snug">
                    {channel.title}
                  </h4>
                  <span className="text-[11px] font-mono text-warm-muted truncate leading-snug pt-0.5">
                    {channel.username ? `@${channel.username}` : `ID: ${channel.id}`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(channel.id)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-warm-subtle hover:text-red-600 hover:bg-[#FAF8F5] border border-transparent hover:border-cream-divider active:scale-90 transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-[17px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};