import { AccountProvider } from '../lib/account';
import { DataProvider, getStore } from '../lib/data';
import { ToastProvider } from '../ui/toast';
import { AppShell } from './AppShell';

// Providers, outermost first: toasts, the signed-in account, then this person's data.
const beforeSignOut = (uid: string) => getStore().signOutCleanup(uid);

export default function App() {
  return (
    <ToastProvider>
      <AccountProvider beforeSignOut={beforeSignOut}>
        <DataProvider>
          <AppShell />
        </DataProvider>
      </AccountProvider>
    </ToastProvider>
  );
}
