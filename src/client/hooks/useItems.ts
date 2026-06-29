import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Item } from '../../shared/types';
import {
  createItem,
  deleteItem,
  getCategories,
  getItem,
  getItems,
  updateItem,
  type CreateItemInput,
  type ItemFilters,
  type UpdateItemInput,
} from '../api';

const ITEMS_KEY = ['items'];

export function useItems(filters: ItemFilters = {}) {
  return useQuery<Item[]>({
    // Key by the filters so changing the search/category/lowStock refetches.
    queryKey: ['items', filters],
    queryFn: () => getItems(filters),
  });
}

export function useCategories() {
  return useQuery<string[]>({
    queryKey: ['items', 'categories'],
    queryFn: getCategories,
  });
}

export function useItem(id: string | undefined) {
  return useQuery<Item>({
    queryKey: ['items', id],
    queryFn: () => getItem(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemInput) => createItem(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateItemInput) => updateItem(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      qc.invalidateQueries({ queryKey: ['items', id] });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}
