import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { tokens } from '../../src/theme';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiGetSubmissions, type Submission } from '../../src/api/submissions';
import { SummaryHeader } from '../../src/components/activity/SummaryHeader';
import { SubmissionRow } from '../../src/components/activity/SubmissionRow';
import { deriveSummary } from '../../src/components/activity/deriveSummary';
import { TopChrome } from '../../src/components/TopChrome';

const LIMIT = 20;

export default function ActivityScreen() {
  const { t } = useTranslation();
  const { accessToken, isLoading: authLoading } = useAuth();

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (!accessToken) return;
      // Prevent double-tap race: block concurrent load-more calls
      if (targetPage > 1) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
      }
      if (targetPage === 1) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      try {
        const res = await apiGetSubmissions(accessToken, targetPage, LIMIT);
        setSubmissions((prev) => (replace ? res.data : [...prev, ...res.data]));
        setTotal(res.total);
        setPage(targetPage);
      } catch {
        setError(t('activity.errorLoading'));
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [accessToken, t],
  );

  useEffect(() => {
    void loadPage(1, true);
  }, [loadPage]);

  // Refresh on focus + 30s poll while focused so newly-submitted rows + status
  // transitions (pending → verified/rejected) appear without re-login.
  // Pipeline can be slow with retries; keep the poll cadence tight here.
  useFocusEffect(
    useCallback(() => {
      void loadPage(1, true);
      const id = setInterval(() => void loadPage(1, true), 30_000);
      return () => clearInterval(id);
    }, [loadPage]),
  );

  const hasMore = page * LIMIT < total;
  const summary = useMemo(() => deriveSummary(submissions), [submissions]);

  const handleRowPress = useCallback((item: Submission) => {
    // Guard empty station.id from backend drift — pushing `stationId=''` would
    // navigate but the map effect would treat it as absent and no-op silently.
    if (!item.station?.id) return;
    // Tabs navigation: push to map index with stationId param so map opens the
    // station detail sheet once its nearby-stations fetch returns that id.
    router.push({ pathname: '/(app)', params: { stationId: item.station.id } });
  }, []);

  // Gate the summary card on verifiedCount > 0: a user with only pending or
  // rejected rows should not see "0 zgłoszeń · 0 stacji · Aktywny od dziś".
  // Memo the element so the FlatList header reference is stable across renders.
  const listHeader = useMemo(
    () => (summary.verifiedCount > 0
      ? <SummaryHeader summary={summary} approxActiveSince={hasMore} />
      : null),
    [summary, hasMore],
  );

  // Compute the body once, then wrap in TopChrome — all five paths share
  // the same chrome + safe-area treatment instead of each path needing its
  // own SafeAreaView wrapper.
  let body: ReactNode;
  if (authLoading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  } else if (!accessToken) {
    body = (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t('activity.signInPrompt')}</Text>
      </View>
    );
  } else if (isLoading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadPage(1, true)}>
          <Text style={styles.retryText}>{t('activity.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <FlatList
        style={styles.list}
        contentContainerStyle={submissions.length === 0 ? styles.emptyContainer : undefined}
        data={submissions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SubmissionRow item={item} onPress={handleRowPress} />}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => void loadPage(1, true)}
            tintColor={tokens.brand.accent}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{t('activity.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('activity.emptySubtitle')}</Text>
          </View>
        }
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity
              style={styles.loadMoreButton}
              onPress={() => void loadPage(page + 1, false)}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <ActivityIndicator size="small" color={tokens.brand.accent} />
              ) : (
                <Text style={styles.loadMoreText}>{t('activity.loadMore')}</Text>
              )}
            </TouchableOpacity>
          ) : null
        }
      />
    );
  }

  return (
    <View style={styles.screen}>
      <TopChrome />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface.page },
  list: { flex: 1, backgroundColor: tokens.surface.page },
  emptyContainer: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: tokens.surface.page,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: tokens.neutral.n800, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: tokens.neutral.n400, textAlign: 'center' },
  errorText: { fontSize: 14, color: tokens.price.expensive, marginBottom: 16, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  retryText: { color: tokens.brand.accent, fontSize: 14, fontWeight: '500' },
  loadMoreButton: {
    margin: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
  },
  loadMoreText: { color: tokens.brand.accent, fontSize: 14, fontWeight: '500' },
});
