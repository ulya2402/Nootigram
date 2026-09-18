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
    <div className="flex flex-col w-full px-6 safe-bottom-space">
      <section className="pt-2 pb-3 border-b border-cream-divider/60 flex flex-col gap-1 select-none">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
            {t('channels_title')}
          </span>
          <span className="text-[11px] font-mono text-warm-muted">
            {channels.length}/5
          </span>
        </div>
        <div className="flex items-end justify-between gap-3 pt-0.5">
          <p className="text-xs leading-relaxed text-warm-muted font-normal max-w-[250px]">
            {t('channels_sub')}
          </p>
          <button
            type="button"
            onClick={handleConnectChannel}
            disabled={channels.length >= 5}
            className="h-7 px-3 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-semibold flex items-center gap-1 active:opacity-75 transition-opacity duration-100 disabled:opacity-40 shrink-0 select-none"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">add</span>
            <span>{t('add_channel')}</span>
          </button>
        </div>
      </section>

      {alertNotice && (
        <div className="my-2.5 py-2 px-3 rounded-lg bg-cream-surface border-l-2 border-warm-accent text-xs text-warm-accent font-medium flex items-center justify-between gap-2">
          <span className="truncate">{alertNotice}</span>
          <button
            type="button"
            onClick={() => setAlertNotice(null)}
            className="text-warm-muted hover:text-warm-text shrink-0 p-0.5 active:opacity-60"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center justify-center text-xs text-warm-muted select-none">
          <span className="material-symbols-outlined text-3xl text-warm-subtle block mb-2">campaign</span>
          <span className="font-semibold text-warm-text text-sm mb-1">{t('empty_channels')}</span>
          <p className="text-xs text-warm-muted max-w-[240px] leading-relaxed">
            {t('channels_sub')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col py-1">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="py-3.5 border-b border-cream-divider/60 flex items-center justify-between gap-3 select-none -mx-2 px-2 rounded-lg transition-colors duration-100 active:bg-cream-surface/70"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="material-symbols-outlined text-[18px] text-warm-subtle shrink-0">
                  campaign
                </span>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-sm font-semibold text-warm-text truncate leading-snug">
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
                className="w-7 h-7 flex items-center justify-center rounded-full text-warm-subtle hover:text-red-600 active:opacity-50 transition-opacity duration-100 shrink-0"
              >
                <span className="material-symbols-outlined text-[16px] leading-none">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};