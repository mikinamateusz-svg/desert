import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { tokens } from '../../theme';
import { useAuth } from '../../store/auth.store';
import {
  apiGetAlerts,
  apiMarkAlertRead,
  apiMarkAllAlertsRead,
  AlertsApiError,
  type AlertRow,
} from '../../api/alerts';
import {
  decrementAlertsUnreadCount,
  incrementAlertsUnreadCount,
  resetAlertsUnreadCount,
  setAlertsUnreadCount,
} from '../../hooks/useAlertsUnreadCount';

/**
 * Story 6.11 — driver-facing inbox below the status banner on /(app)/alerts.
 *
 * Pagination via infinite-scroll: 20 rows per page; `onEndReached` fetches
 * the next page when there are more to load. Pull-to-refresh resets to
 * page 1. Tapping an unread row optimistically marks it read; the hook
 * shared with the bell icon picks up the change and decrements the badge.
 *
 * Empty-state copy lives in i18n (`alerts.inbox.emptyState`). Most early
 * users will be in this state until the alerts loop fires; keep the
 * component simple and the message warm.
 */
const PAGE_SIZE = 20;

interface Props {
  /** Optional header rendered above the list (e.g. status banner). Scrolls with the list. */
  ListHeader?: React.ReactNode;
}

export function AlertsInbox({ ListHeader }: Props) {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  const [items, setItems] = useState<AlertRow[]>([]);
  const [page, setPage] = useState(1);
  // P10 (6.11 review) — default false; only flipped to true by a successful
  // page response that proves there are more rows. Without this, a silent
  // first-load failure leaves hasMore=true and `onEndReached` retries
  // page 2 forever.
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setLocalUnread] = useState(0);
  // P9 (6.11 review) — surface load errors instead of swallowing them.
  // Otherwise an initial-fetch failure leaves items=[] and the empty
  // state ("Brak alertów…") renders as if the user genuinely has none.
  const [loadError, setLoadError] = useState(false);
  // P13 (6.11 review) — track unmount across the async loadPage closure
  // so setStates after unmount are skipped. React 18 ignores them, but
  // the explicit guard avoids state-update warnings in tests / dev mode.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const loadPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (!accessToken) return;
      try {
        const result = await apiGetAlerts(accessToken, targetPage, PAGE_SIZE);
        if (cancelledRef.current) return;
        // P11 (6.11 review) — de-dupe on merge so pagination races / new
        // alerts arriving between page fetches don't produce duplicate
        // React keys. Newer rows always win (the freshest fetch wraps
        // older state).
        setItems((prev) => {
          if (replace) return result.data;
          const known = new Set(prev.map((r) => r.id));
          return [...prev, ...result.data.filter((r) => !known.has(r.id))];
        });
        setPage(targetPage);
        setHasMore(targetPage * PAGE_SIZE < result.total);
        setLocalUnread(result.unread_count);
        setAlertsUnreadCount(result.unread_count);
        setLoadError(false);
      } catch {
        if (cancelledRef.current) return;
        // Don't flip hasMore back to true on failure — keep the existing
        // value so onEndReached can't re-trigger a doomed fetch.
        setLoadError(true);
      }
    },
    [accessToken],
  );

  // Initial fetch on mount + accessToken change.
  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadPage(1, true);
      if (!cancelledRef.current) setLoading(false);
    })();
  }, [loadPage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPage(1, true);
    setRefreshing(false);
  }, [loadPage]);

  const handleEndReached = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    await loadPage(page + 1, false);
    setLoadingMore(false);
  }, [hasMore, loadPage, loadingMore, page]);

  const handleRowPress = useCallback(
    async (row: AlertRow) => {
      if (row.read_at !== null) return;
      // Optimistic: flip locally, decrement shared badge, then call the
      // server. Roll back on hard failure (network down). This keeps the
      // tap responsive — the inbox is read-only navigation otherwise.
      const nowIso = new Date().toISOString();
      setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: nowIso } : r)));
      setLocalUnread((c) => Math.max(0, c - 1));
      decrementAlertsUnreadCount();
      try {
        if (accessToken) await apiMarkAlertRead(accessToken, row.id);
      } catch (e: unknown) {
        // P8 (6.11 review) — on 404 the row no longer exists server-side
        // (deleted, or was never the user's). Rolling back to unread
        // would create an infinite re-tap loop; remove the row instead.
        if (e instanceof AlertsApiError && e.status === 404) {
          setItems((prev) => prev.filter((r) => r.id !== row.id));
          // Don't bump the unread badge — the row is gone, not unread.
          return;
        }
        // P7 (6.11 review) — use the symmetric increment helper instead
        // of `setAlertsUnreadCount(unreadCount + 1)` from a stale closure.
        setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: null } : r)));
        setLocalUnread((c) => c + 1);
        incrementAlertsUnreadCount();
      }
    },
    [accessToken],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!accessToken || unreadCount === 0) return;
    const nowIso = new Date().toISOString();
    const snapshotItems = items;
    const snapshotUnread = unreadCount;
    setItems((prev) => prev.map((r) => (r.read_at == null ? { ...r, read_at: nowIso } : r)));
    setLocalUnread(0);
    resetAlertsUnreadCount();
    try {
      await apiMarkAllAlertsRead(accessToken);
      // P15 (6.11 review) — wire the markedAllReadToast i18n key. The
      // alert is informational with no buttons; iOS/Android both auto-
      // dismiss the simple `Alert.alert(message)` form. Matches the
      // export-data pattern in account.tsx.
      Alert.alert('', t('alerts.inbox.markedAllReadToast'));
    } catch {
      // P12 (6.11 review) — rollback restores the FULL snapshot of items
      // (including pages 2..N the user had scrolled into) instead of
      // re-fetching only page 1 and silently dropping the rest.
      setItems(snapshotItems);
      setLocalUnread(snapshotUnread);
      setAlertsUnreadCount(snapshotUnread);
    }
  }, [accessToken, items, t, unreadCount]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AlertRow>) => (
      <AlertRowView row={item} onPress={() => void handleRowPress(item)} t={t} />
    ),
    [handleRowPress, t],
  );

  const ListHeaderComponent = (
    <View>
      {ListHeader}
      {unreadCount > 0 && (
        <View style={styles.markAllRow}>
          <TouchableOpacity
            onPress={() => void handleMarkAllRead()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
          >
            <Text style={styles.markAllText}>{t('alerts.inbox.markAllRead')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        {ListHeader}
        <ActivityIndicator color={tokens.brand.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          {/*
           * P9 (6.11 review) — when items=[] and the last fetch errored,
           * show the load-error copy with a retry affordance instead of
           * the genuine "no alerts yet" message. Otherwise users with
           * an unreachable backend see the same empty UI as users who
           * legitimately have zero alerts.
           */}
          {loadError ? (
            <>
              <Text style={styles.emptyText}>{t('alerts.inbox.errorLoad')}</Text>
              <TouchableOpacity
                onPress={() => void loadPage(1, true)}
                style={styles.retryButton}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>{t('alerts.inbox.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.emptyText}>{t('alerts.inbox.emptyState')}</Text>
          )}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={tokens.brand.accent}
        />
      }
      onEndReached={() => void handleEndReached()}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={tokens.brand.accent} />
          </View>
        ) : null
      }
    />
  );
}

interface RowProps {
  row: AlertRow;
  onPress: () => void;
  t: TFunction;
}

function AlertRowView({ row, onPress, t }: RowProps) {
  const isUnread = row.read_at === null;
  const timeAgo = formatRelativeTime(t, row.sent_at);

  return (
    <TouchableOpacity
      style={[styles.row, isUnread && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: !isUnread }}
    >
      {isUnread && <View style={styles.unreadDot} />}
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, isUnread && styles.rowTitleUnread]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={2}>
          {row.body}
        </Text>
        <Text style={styles.rowTime}>{timeAgo}</Text>
      </View>
    </TouchableOpacity>
  );
}

function formatRelativeTime(t: TFunction, sentAt: string): string {
  const sentMs = new Date(sentAt).getTime();
  if (Number.isNaN(sentMs)) return '';
  // P14 (6.11 review) — explicit "future timestamp" branch. Without it,
  // clock skew between server and client (or a misbehaving worker) lets
  // negative diffs fall through to `< 60_000`, silently rendering "just
  // now" for arbitrary-far-future timestamps. Pin to the same copy but
  // make the intent explicit.
  const diff = Date.now() - sentMs;
  if (diff < 0) return t('alerts.inbox.timeAgo.justNow');
  if (diff < 60_000) return t('alerts.inbox.timeAgo.justNow');
  if (diff < 3_600_000) {
    return t('alerts.inbox.timeAgo.minutes', { count: Math.floor(diff / 60_000) });
  }
  if (diff < 86_400_000) {
    return t('alerts.inbox.timeAgo.hours', { count: Math.floor(diff / 3_600_000) });
  }
  return t('alerts.inbox.timeAgo.days', { count: Math.floor(diff / 86_400_000) });
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: tokens.surface.page,
    paddingTop: 32,
    alignItems: 'center',
  },
  markAllRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  markAllText: {
    color: tokens.brand.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  rowUnread: {
    backgroundColor: tokens.surface.warmPage,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.brand.accent,
    marginTop: 8,
    marginRight: 10,
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    color: tokens.brand.ink,
    marginBottom: 2,
  },
  rowTitleUnread: {
    fontWeight: '700',
  },
  rowBody: {
    fontSize: 13,
    color: tokens.neutral.n500,
    lineHeight: 18,
    marginBottom: 4,
  },
  rowTime: {
    fontSize: 11,
    color: tokens.neutral.n400,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  retryText: {
    color: tokens.brand.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
