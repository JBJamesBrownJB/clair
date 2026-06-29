import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { useCategories, useCreateItem, useItems } from '../hooks/useItems';
import { exportItems, type CreateItemInput, type ExportFormat, type ItemFilters } from '../api';

const EMPTY_FORM: CreateItemInput = {
  name: '',
  category: '',
  location: '',
  quantity: 0,
  unit: 'units',
  lowStockThreshold: 0,
};

export default function ItemsPage() {
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [lowStock, setLowStock] = useState(false);

  const filters: ItemFilters = {
    q: q || undefined,
    category: category || undefined,
    lowStock: lowStock || undefined,
  };

  const { data: items, isPending, isError, error } = useItems(filters);
  const { data: categories } = useCategories();
  const createItem = useCreateItem();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateItemInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleOpen = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await createItem.mutateAsync(form);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create item');
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExportError(null);
    setExporting(format);
    try {
      // Honour the active filters so the export matches the current view.
      const blob = await exportItems(format, filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `larder-items.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
      >
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Items
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={() => handleExport('csv')}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleExport('json')}
            disabled={exporting !== null}
          >
            {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
          </Button>
          <Button variant="contained" onClick={handleOpen}>
            New item
          </Button>
        </Stack>
      </Stack>

      {/* Filter bar */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 3 }}
      >
        <TextField
          label="Search"
          size="small"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <TextField
          label="Category"
          size="small"
          select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All categories</MenuItem>
          {(categories ?? []).map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={lowStock}
              onChange={(e) => setLowStock(e.target.checked)}
            />
          }
          label="Low stock only"
        />
      </Stack>

      {exportError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {exportError}
        </Alert>
      )}

      {isPending && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && (
        <Alert severity="error">
          {error instanceof Error ? error.message : 'Failed to load items'}
        </Alert>
      )}

      {items && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Location</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell>Unit</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                      No items match the current filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => {
                const low = item.quantity <= item.lowStockThreshold;
                return (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      ...(low ? { bgcolor: '#fdecea' } : null),
                    }}
                    onClick={() => navigate(`/items/${item.id}`)}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.location}</TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell>
                      {low ? (
                        <Chip label="Low" color="error" size="small" />
                      ) : (
                        <Chip label="OK" color="success" size="small" variant="outlined" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <DialogTitle>New item</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {formError && <Alert severity="error">{formError}</Alert>}
              <TextField
                label="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label="Category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
                fullWidth
              />
              <TextField
                label="Location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                required
                fullWidth
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Quantity"
                  type="number"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: Number(e.target.value) })
                  }
                  required
                  fullWidth
                  inputProps={{ min: 0 }}
                />
                <TextField
                  label="Unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  fullWidth
                />
              </Stack>
              <TextField
                label="Low stock threshold"
                type="number"
                value={form.lowStockThreshold}
                onChange={(e) =>
                  setForm({ ...form, lowStockThreshold: Number(e.target.value) })
                }
                fullWidth
                inputProps={{ min: 0 }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createItem.isPending}>
              {createItem.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
