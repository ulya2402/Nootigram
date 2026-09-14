import { t } from '../services/i18n';

export function formatRelativeTime(dateStr: string): string {
  if (!dateStr || dateStr === 'Baru saja' || dateStr === 'Recently' || dateStr === 'Just now') {
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