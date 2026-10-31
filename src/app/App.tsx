import { AccountProvider } from '../lib/account';
import { DataProvider, getStore } from '../lib/data';
import { ClubsProvider, clearClubCache } from '../lib/club-data';
import { ToastProvider } from '../ui/toast';
import { AppShell } from './AppShell';
import { UpdatePrompt } from './UpdatePrompt';

// Providers, outermost first: toasts, the signed-in account, this person's data, then the clubs they belong to.
const beforeSignOut = async (uid: string) => { clearClubCache(uid); await getStore().signOutCleanup(uid); };

export default function App() {
  return (
    <ToastProvider>
      <AccountProvider beforeSignOut={beforeSignOut}>
        <DataProvider>
          <ClubsProvider>
            <AppShell />
          </ClubsProvider>
        </DataProvider>
      </AccountProvider>
      <UpdatePrompt />
    </ToastProvider>
  );
}
