import {
  AppBar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

const NAV_LINKS = [
  { label: 'Items', to: '/' },
  { label: 'Checkouts', to: '/checkouts' },
  { label: 'Users', to: '/users' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, mr: 4 }}>
            Larder
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1 }}>
            {NAV_LINKS.map((link) => (
              <Button
                key={link.to}
                component={RouterLink}
                to={link.to}
                color="inherit"
                sx={{
                  fontWeight: isActive(link.to) ? 700 : 400,
                  borderBottom: isActive(link.to)
                    ? '2px solid white'
                    : '2px solid transparent',
                  borderRadius: 0,
                }}
              >
                {link.label}
              </Button>
            ))}
          </Stack>
          {user && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="body2">{user.name}</Typography>
              <Button color="inherit" variant="outlined" onClick={handleLogout}>
                Logout
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
