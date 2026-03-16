import { RouterProvider } from 'react-router';
import { router } from './routes';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { Toaster } from './components/ui/sonner';

function App() {
  return (
    <OrganizationProvider>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="bottom-right" richColors />
    </OrganizationProvider>
  );
}

export default App;