import { useQuery } from '@tanstack/react-query';
import type { User } from '../../shared/types';
import { getUsers } from '../api';

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: getUsers,
  });
}
