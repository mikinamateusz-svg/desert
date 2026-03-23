import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiGetSubmissions, type Submission } from '../../src/api/submissions';

const LIMIT = 20;

const FUEL_TYPE_KEYS: Record<string, string> = {
  petrol_95: 'Petrol 95',
  petrol_98: 'Petrol 98',
  diesel: 'Diesel',
  lpg: 'LPG',
};

function formatFuelType(fuelType: string): string {
  return FUEL_TYPE_KEYS[fuelType] ?? fuelType;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function SubmissionRow({ item, t }: { item: Submission; t: (k: string) => string }) {
  const stationName =
    item.station?.name ?? t('submissions.stationUnknown');

  const prices = item.price_data
    .map((p) => `${formatFuelType(p.fuel_type)}: ${p.price_per_litre.toFixed(2)}`)
    .join('  ');

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.stationName} numberOfLines={1}>
          {stationName}
        </Text>
        <Text style={styles.date}>{formatDate(item.created_at)}</Text>
      </View>
      <Text style={styles.prices} numberOfLines={1}>
        {prices || '—'}
      </Text>
      {item.status === 'rejected' && (
        <Text style={styles.rejectedBadge}>{t('submissions.statusRejected')}</Text>
      )}
      {item.status === 'pending' && (
        <Text style={styles.pendingBadge}>{t('submissions.statusPending')}</Text>
      )}
    </View>
  );
}

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
        setError(t('submissions.errorLoading'));
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

  // P3: wait for auth to restore from storage before deciding what to show
  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t('submissions.signInPrompt')}</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadPage(1, true)}>
          <Text style={styles.retryText}>{t('submissions.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasMore = page * LIMIT < total;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={submissions.length === 0 ? styles.emptyContainer : undefined}
      data={submissions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <SubmissionRow item={item} t={t} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{t('submissions.emptyTitle')}</Text>
          <Text style={styles.emptySubtitle}>{t('submissions.emptySubtitle')}</Text>
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
              <ActivityIndicator size="small" color="#f59e0b" />
            ) : (
              <Text style={styles.loadMoreText}>{t('submissions.loadMore')}</Text>
            )}
          </TouchableOpacity>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#fff' },
  emptyContainer: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stationName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginRight: 8 },
  date: { fontSize: 12, color: '#888' },
  prices: { fontSize: 13, color: '#555', marginBottom: 4 },
  rejectedBadge: { fontSize: 11, color: '#d97706', fontWeight: '500' },
  pendingBadge: { fontSize: 11, color: '#888', fontStyle: 'italic' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center' },
  errorText: { fontSize: 14, color: '#ef4444', marginBottom: 16, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  retryText: { color: '#f59e0b', fontSize: 14, fontWeight: '500' },
  loadMoreButton: {
    margin: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
  },
  loadMoreText: { color: '#f59e0b', fontSize: 14, fontWeight: '500' },
});
