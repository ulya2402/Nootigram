import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const prevCount = channels.length;
    const checkUpdate = async () => {
      const updated = await onRefresh();
      if (updated.length > prevCount) {
        triggerHaptic('medium');
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
        setAlertNotice(t('channel_connected_alert'));
        setTimeout(() => setAlertNotice(null), 3500);
      }
    };
    window.addEventListener('focus', checkUpdate);
    document.addEventListener('visibilitychange', checkUpdate);
    return () => {
      window.removeEventListener('focus', checkUpdate);
      document.removeEventListener('visibilitychange', checkUpdate);
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
      <section className="pt-2 pb-3 border-b border-cream-divider flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-warm-accent tracking-widest uppercase">
              {t('channels_title')}
            </span>
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-cream-surface border border-cream-divider text-warm-muted">
              {channels.length}/5
            </span>
          </div>
          <p className="text-xs text-warm-muted mt-0.5">{t('channels_sub')}</p>
        </div>
        <button
          onClick={handleConnectChannel}
          disabled={channels.length >= 5}
          className="px-3 py-1.5 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-semibold flex items-center gap-1 physics-bounce disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
          <span>{t('add_channel')}</span>
        </button>
      </section>

      {alertNotice && (
        <div className="my-2 p-2.5 rounded-lg bg-cream-surface border border-cream-divider text-xs text-warm-accent font-medium flex items-center justify-between animate-page-fade">
          <span>{alertNotice}</span>
          <button onClick={() => setAlertNotice(null)} className="text-warm-muted hover:text-warm-text">
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      )}

      <section className="pt-2 pb-3 border-b border-cream-divider/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-warm-text uppercase tracking-wider truncate">
            {t('channels_title')}
          </span>
          <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-cream-surface border border-cream-divider/60 text-warm-muted shrink-0">
            {channels.length}/5
          </span>
        </div>
        <button
          onClick={handleConnectChannel}
          disabled={channels.length >= 5}
          className="h-7 px-2.5 rounded-full bg-warm-text text-[#FAF8F5] text-[11px] font-medium flex items-center gap-1 physics-bounce disabled:opacity-40 shrink-0"
        >
          <span className="material-symbols-outlined text-[14px] leading-none">add</span>
          <span>{t('add_channel')}</span>
        </button>
      </section>

      {alertNotice && (
        <div className="my-2 p-2 rounded-lg bg-cream-surface border border-cream-divider text-xs text-warm-accent font-medium flex items-center justify-between animate-page-fade">
          <span>{alertNotice}</span>
          <button onClick={() => setAlertNotice(null)} className="text-warm-muted hover:text-warm-text">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center justify-center gap-1.5 text-xs text-warm-muted select-none">
          <span className="material-symbols-outlined text-3xl text-warm-subtle">hub</span>
          <span className="pt-1">{t('empty_channels')}</span>
        </div>
      ) : (
        <div className="flex flex-col py-1">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="py-2.5 border-b border-cream-divider/40 flex items-center justify-between gap-3 group transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-cream-surface border border-cream-divider/80 flex items-center justify-center shrink-0 text-warm-accent select-none">
                  <span className="material-symbols-outlined text-[16px] leading-none">tag</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-xs font-semibold text-warm-text truncate leading-tight">{channel.title}</h4>
                  <span className="text-[11px] font-mono text-warm-muted truncate leading-tight pt-0.5">
                    {channel.username ? `@${channel.username}` : `ID: ${channel.id}`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(channel.id)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-warm-subtle hover:text-red-600 active:scale-90 transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};