import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role, User } from '../../shared/types';
import { getUsers, updateUserRole } from '../api';

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: getUsers,
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      updateUserRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
