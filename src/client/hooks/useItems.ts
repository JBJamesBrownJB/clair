import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Item } from '../../shared/types';
import {
  createItem,
  deleteItem,
  getItem,
  getItems,
  updateItem,
  type CreateItemInput,
  type UpdateItemInput,
} from '../api';

const ITEMS_KEY = ['items'];

export function useItems() {
  return useQuery<Item[]>({
    queryKey: ITEMS_KEY,
    queryFn: getItems,
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
      qc.invalidateQueries(ITEMS_KEY);
    },
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateItemInput) => updateItem(id, input),
    onSuccess: () => {
      qc.invalidateQueries(ITEMS_KEY);
      qc.invalidateQueries(['items', id]);
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => {
      qc.invalidateQueries(ITEMS_KEY);
    },
  });
}
