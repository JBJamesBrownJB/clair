import {
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { ROLES, type Role } from '../../shared/types';
import { useUpdateUserRole, useUsers } from '../hooks/useUsers';

export default function UsersPage() {
  const { data: users, isPending, isError, error } = useUsers();
  const updateRole = useUpdateUserRole();

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Users
      </Typography>

      {isPending && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && (
        <Alert severity="error">
          {error instanceof Error ? error.message : 'Failed to load users'}
        </Alert>
      )}

      {updateRole.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {updateRole.error instanceof Error
            ? updateRole.error.message
            : 'Failed to update role'}
        </Alert>
      )}

      {users && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={u.role}
                      disabled={updateRole.isPending}
                      onChange={(e) =>
                        updateRole.mutate({
                          id: u.id,
                          role: e.target.value as Role,
                        })
                      }
                      sx={{ minWidth: 120 }}
                    >
                      {ROLES.map((role) => (
                        <MenuItem key={role} value={role}>
                          {role}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
