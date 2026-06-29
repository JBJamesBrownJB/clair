import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckoutRecord } from '../../shared/types';
import {
  createCheckout,
  getCheckouts,
  returnCheckout,
  type CreateCheckoutInput,
} from '../api';

const CHECKOUTS_KEY = ['checkouts'];

export function useCheckouts() {
  return useQuery<CheckoutRecord[]>({
    queryKey: CHECKOUTS_KEY,
    queryFn: getCheckouts,
  });
}

export function useCreateCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCheckoutInput) => createCheckout(input),
    onSuccess: () => {
      qc.invalidateQueries(CHECKOUTS_KEY);
      qc.invalidateQueries(['items']);
    },
  });
}

export function useReturnCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => returnCheckout(id),
    onSuccess: () => {
      qc.invalidateQueries(CHECKOUTS_KEY);
      qc.invalidateQueries(['items']);
    },
  });
}
