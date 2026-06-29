import type { PrismaClient } from '@prisma/client';
import { prisma } from '../src/server/prisma';

/**
 * Deterministic seed — no wall-clock, no RNG. Identical starting state on every
 * run so the hidden acceptance gate can assert against known values:
 *
 *   - exactly 40 items
 *   - exactly 3 items whose name contains "microscope" (case-insensitive)
 *   - exactly 6 low-stock items (quantity <= lowStockThreshold)
 *   - 4 users: 1 admin, 2 members, 1 viewer (password: "password123")
 *   - 5 checkout records (3 active / not yet returned, 2 returned)
 *
 * Seeding is arena prep, never agent-generated.
 */

// Fixed bcrypt hash of "password123" — embedded so the seed carries no RNG.
const PASSWORD_HASH = '$2a$10$GgnobmcZIP3xpGlv87gh0eNWF6tNE5qPVFCFKPNOdd3voEzzfF47W';

const EPOCH = '2024-01-01T00:00:00.000Z';

function dayOffset(days: number): Date {
  return new Date(Date.parse(EPOCH) + days * 24 * 60 * 60 * 1000);
}

interface SeedItem {
  id: string;
  name: string;
  category: string;
  location: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  barcode: string | null;
  notes: string | null;
}

const CATEGORIES = ['Glassware', 'Reagents', 'Instruments', 'Consumables', 'PPE', 'Electronics'];
const LOCATIONS = [
  'Lab A - Shelf 1',
  'Lab A - Shelf 2',
  'Lab B - Bench 3',
  'Cold Room',
  'Store Cupboard',
  'Fume Hood 1',
];

// 40 items. Names are fixed; the three "microscope" entries are explicit so the
// search gate has a known answer.
const ITEM_NAMES: Array<{ name: string; category: string; unit: string }> = [
  { name: 'Compound Microscope', category: 'Instruments', unit: 'units' },
  { name: 'Stereo Microscope', category: 'Instruments', unit: 'units' },
  { name: 'Digital USB Microscope', category: 'Electronics', unit: 'units' },
  { name: 'Beaker 250ml', category: 'Glassware', unit: 'units' },
  { name: 'Beaker 500ml', category: 'Glassware', unit: 'units' },
  { name: 'Erlenmeyer Flask 250ml', category: 'Glassware', unit: 'units' },
  { name: 'Volumetric Flask 100ml', category: 'Glassware', unit: 'units' },
  { name: 'Graduated Cylinder 100ml', category: 'Glassware', unit: 'units' },
  { name: 'Test Tube Rack', category: 'Glassware', unit: 'units' },
  { name: 'Petri Dish 90mm', category: 'Consumables', unit: 'units' },
  { name: 'Pipette Tips 1000ul', category: 'Consumables', unit: 'boxes' },
  { name: 'Pipette Tips 200ul', category: 'Consumables', unit: 'boxes' },
  { name: 'Nitrile Gloves (M)', category: 'PPE', unit: 'boxes' },
  { name: 'Nitrile Gloves (L)', category: 'PPE', unit: 'boxes' },
  { name: 'Safety Goggles', category: 'PPE', unit: 'units' },
  { name: 'Lab Coat', category: 'PPE', unit: 'units' },
  { name: 'Sodium Chloride', category: 'Reagents', unit: 'g' },
  { name: 'Ethanol Absolute', category: 'Reagents', unit: 'ml' },
  { name: 'Acetone', category: 'Reagents', unit: 'ml' },
  { name: 'Hydrochloric Acid 1M', category: 'Reagents', unit: 'ml' },
  { name: 'Sodium Hydroxide Pellets', category: 'Reagents', unit: 'g' },
  { name: 'Agar Powder', category: 'Reagents', unit: 'g' },
  { name: 'Phosphate Buffer', category: 'Reagents', unit: 'ml' },
  { name: 'Analytical Balance', category: 'Instruments', unit: 'units' },
  { name: 'Magnetic Stirrer', category: 'Instruments', unit: 'units' },
  { name: 'Hot Plate', category: 'Instruments', unit: 'units' },
  { name: 'Centrifuge', category: 'Instruments', unit: 'units' },
  { name: 'pH Meter', category: 'Instruments', unit: 'units' },
  { name: 'Vortex Mixer', category: 'Instruments', unit: 'units' },
  { name: 'Water Bath', category: 'Instruments', unit: 'units' },
  { name: 'Micropipette 10ul', category: 'Instruments', unit: 'units' },
  { name: 'Micropipette 100ul', category: 'Instruments', unit: 'units' },
  { name: 'Micropipette 1000ul', category: 'Instruments', unit: 'units' },
  { name: 'Thermometer Digital', category: 'Electronics', unit: 'units' },
  { name: 'Timer', category: 'Electronics', unit: 'units' },
  { name: 'UV Lamp', category: 'Electronics', unit: 'units' },
  { name: 'Parafilm Roll', category: 'Consumables', unit: 'rolls' },
  { name: 'Weighing Boats', category: 'Consumables', unit: 'packs' },
  { name: 'Filter Paper', category: 'Consumables', unit: 'packs' },
  { name: 'Cryo Vials', category: 'Consumables', unit: 'packs' },
];

// Items at these indices (0-based) are low-stock (quantity <= threshold): 6 of them.
const LOW_STOCK_INDICES = new Set([3, 10, 16, 19, 27, 36]);

const ITEMS: SeedItem[] = ITEM_NAMES.map((entry, i) => {
  const idNum = String(i + 1).padStart(2, '0');
  const lowStock = LOW_STOCK_INDICES.has(i);
  const threshold = 5;
  const quantity = lowStock ? Math.max(0, threshold - ((i % 5) + 1)) : threshold + 10 + (i % 20);
  return {
    id: `item-${idNum}`,
    name: entry.name,
    category: entry.category,
    location: LOCATIONS[i % LOCATIONS.length],
    quantity,
    unit: entry.unit,
    lowStockThreshold: threshold,
    barcode: `LARD-${idNum}-${entry.category.slice(0, 3).toUpperCase()}`,
    notes: i % 7 === 0 ? 'Handle with care.' : null,
  };
});

const USERS = [
  { id: 'user-admin', email: 'alice@larder.test', name: 'Alice Admin', role: 'admin' },
  { id: 'user-bob', email: 'bob@larder.test', name: 'Bob Member', role: 'member' },
  { id: 'user-carol', email: 'carol@larder.test', name: 'Carol Member', role: 'member' },
  { id: 'user-viewer', email: 'dave@larder.test', name: 'Dave Viewer', role: 'viewer' },
];

interface SeedCheckout {
  id: string;
  itemId: string;
  userId: string;
  quantity: number;
  note: string | null;
  checkedOutDay: number;
  returnedDay: number | null;
}

const CHECKOUTS: SeedCheckout[] = [
  { id: 'co-1', itemId: 'item-01', userId: 'user-bob', quantity: 1, note: 'Imaging session', checkedOutDay: 10, returnedDay: null },
  { id: 'co-2', itemId: 'item-24', userId: 'user-carol', quantity: 1, note: null, checkedOutDay: 12, returnedDay: null },
  { id: 'co-3', itemId: 'item-27', userId: 'user-bob', quantity: 1, note: 'Spin down samples', checkedOutDay: 13, returnedDay: 18 },
  { id: 'co-4', itemId: 'item-11', userId: 'user-carol', quantity: 2, note: null, checkedOutDay: 14, returnedDay: 20 },
  { id: 'co-5', itemId: 'item-03', userId: 'user-bob', quantity: 1, note: 'Field loan', checkedOutDay: 15, returnedDay: null },
];

// Reusable seeding routine — tests call this to restore the known state, and
// the CLI runner below calls it against the process-wide client.
export async function seed(client: PrismaClient = prisma): Promise<void> {
  // Idempotent: clear in dependency order.
  await client.checkoutRecord.deleteMany();
  await client.item.deleteMany();
  await client.user.deleteMany();

  for (const u of USERS) {
    await client.user.create({
      data: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: PASSWORD_HASH,
        createdAt: dayOffset(0),
      },
    });
  }

  for (const item of ITEMS) {
    await client.item.create({
      data: { ...item, createdAt: dayOffset(0), updatedAt: dayOffset(0) },
    });
  }

  for (const co of CHECKOUTS) {
    await client.checkoutRecord.create({
      data: {
        id: co.id,
        itemId: co.itemId,
        userId: co.userId,
        quantity: co.quantity,
        note: co.note,
        checkedOutAt: dayOffset(co.checkedOutDay),
        returnedAt: co.returnedDay === null ? null : dayOffset(co.returnedDay),
      },
    });
  }

  const counts = {
    items: await client.item.count(),
    users: await client.user.count(),
    checkouts: await client.checkoutRecord.count(),
  };
  // eslint-disable-next-line no-console
  console.log('Seed complete:', counts, '| categories:', CATEGORIES.length);
}

// Run as a CLI (tsx prisma/seed.ts) but stay import-safe for the test suite.
const invokedDirectly = Boolean(process.argv[1] && process.argv[1].endsWith('seed.ts'));
if (invokedDirectly) {
  seed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
