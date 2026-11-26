'use client';

import { storeFetch } from '@/lib/stores/browser';

import useSWR from 'swr';

const fetcher = async (url: string) => {
  const response = await storeFetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Dashboard data could not be loaded');
  return data;
};

export function useDashboardMetrics(filters?: { month?: number; year?: number; period?: string }) {
  const params = new URLSearchParams();
  if (filters?.month !== undefined) params.append('month', filters.month.toString());
  if (filters?.year !== undefined) params.append('year', filters.year.toString());
  if (filters?.period) params.append('period', filters.period);

  const url = `/api/metrics${params.toString() ? `?${params.toString()}` : ''}`;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  });

  return {
    metrics: data,
    isLoading,
    isError: error,
    mutate
  };
}
