import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCheckouts, useReturnCheckout } from '../hooks/useCheckouts';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function CheckoutsPage() {
  const { data: checkouts, isPending, isError, error } = useCheckouts();
  const returnCheckout = useReturnCheckout();

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Checkouts
      </Typography>

      {isPending && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && (
        <Alert severity="error">
          {error instanceof Error ? error.message : 'Failed to load checkouts'}
        </Alert>
      )}

      {checkouts && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Item ID</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell>Checked out</TableCell>
                <TableCell>Returned</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {checkouts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                      No checkout records.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {checkouts.map((c) => {
                const active = !c.returnedAt;
                return (
                  <TableRow key={c.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{c.itemId}</TableCell>
                    <TableCell align="right">{c.quantity}</TableCell>
                    <TableCell>{formatDate(c.checkedOutAt)}</TableCell>
                    <TableCell>{formatDate(c.returnedAt)}</TableCell>
                    <TableCell>
                      {active ? (
                        <Chip label="Active" color="warning" size="small" />
                      ) : (
                        <Chip
                          label="Returned"
                          color="default"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {active && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => returnCheckout.mutate(c.id)}
                          disabled={returnCheckout.isPending}
                        >
                          Return
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
