import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate, useParams, Link as RouterLink } from 'react-router';
import { useDeleteItem, useItem, useUpdateItem } from '../hooks/useItems';
import { useCreateCheckout } from '../hooks/useCheckouts';
import type { UpdateItemInput } from '../api';

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: item, isPending, isError, error } = useItem(id);
  const updateItem = useUpdateItem(id ?? '');
  const deleteItem = useDeleteItem();
  const createCheckout = useCreateCheckout();

  const [form, setForm] = useState<UpdateItemInput>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutQty, setCheckoutQty] = useState(1);
  const [checkoutNote, setCheckoutNote] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name,
        category: item.category,
        location: item.location,
        quantity: item.quantity,
        unit: item.unit,
        lowStockThreshold: item.lowStockThreshold,
        barcode: item.barcode,
        notes: item.notes,
      });
    }
  }, [item]);

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !item) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error instanceof Error ? error.message : 'Item not found'}
        </Alert>
        <Button component={RouterLink} to="/">
          Back to items
        </Button>
      </Box>
    );
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setEditError(null);
    try {
      await updateItem.mutateAsync(form);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem.mutateAsync(item.id);
      navigate('/');
    } catch {
      setConfirmOpen(false);
    }
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);
    try {
      await createCheckout.mutateAsync({
        itemId: item.id,
        quantity: checkoutQty,
        note: checkoutNote || null,
      });
      setCheckoutOpen(false);
      setCheckoutQty(1);
      setCheckoutNote('');
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
    }
  };

  const low = item.quantity <= item.lowStockThreshold;

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {item.name}
          </Typography>
          {low && <Chip label="Low stock" color="error" />}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => setCheckoutOpen(true)}>
            Check out
          </Button>
          <Button color="error" variant="outlined" onClick={() => setConfirmOpen(true)}>
            Delete
          </Button>
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {item.quantity} {item.unit} in {item.location} · {item.category}
      </Typography>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Edit item
          </Typography>
          <Divider sx={{ mb: 3 }} />
          <form onSubmit={handleSave}>
            <Stack spacing={2}>
              {editError && <Alert severity="error">{editError}</Alert>}
              <TextField
                label="Name"
                value={form.name ?? ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                fullWidth
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Category"
                  value={form.category ?? ''}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Location"
                  value={form.location ?? ''}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  fullWidth
                />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Quantity"
                  type="number"
                  value={form.quantity ?? 0}
                  onChange={(e) =>
                    setForm({ ...form, quantity: Number(e.target.value) })
                  }
                  fullWidth
                  inputProps={{ min: 0 }}
                />
                <TextField
                  label="Unit"
                  value={form.unit ?? ''}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="Low stock threshold"
                  type="number"
                  value={form.lowStockThreshold ?? 0}
                  onChange={(e) =>
                    setForm({ ...form, lowStockThreshold: Number(e.target.value) })
                  }
                  fullWidth
                  inputProps={{ min: 0 }}
                />
              </Stack>
              <TextField
                label="Barcode"
                value={form.barcode ?? ''}
                onChange={(e) =>
                  setForm({ ...form, barcode: e.target.value || null })
                }
                fullWidth
              />
              <TextField
                label="Notes"
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                fullWidth
                multiline
                minRows={2}
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={updateItem.isPending}
                >
                  {updateItem.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </Box>
            </Stack>
          </form>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete item?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently remove <strong>{item.name}</strong>. This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleteItem.isPending}
          >
            {deleteItem.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Checkout dialog */}
      <Dialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <form onSubmit={handleCheckout}>
          <DialogTitle>Check out {item.name}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {checkoutError && <Alert severity="error">{checkoutError}</Alert>}
              <TextField
                label="Quantity"
                type="number"
                value={checkoutQty}
                onChange={(e) => setCheckoutQty(Number(e.target.value))}
                required
                fullWidth
                inputProps={{ min: 1, max: item.quantity }}
              />
              <TextField
                label="Note"
                value={checkoutNote}
                onChange={(e) => setCheckoutNote(e.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCheckoutOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createCheckout.isPending}
            >
              {createCheckout.isPending ? 'Checking out…' : 'Check out'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
