import { Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { TicketDrawer } from './components/TicketDrawer';
import { useNotifications } from './hooks/useNotifications';
import { useSocketSync } from './hooks/useSocketSync';
import { BoardPage } from './pages/BoardPage';

/** Mounted only once signed in (if BOARD_TOKEN is set), so the socket connects with the cookie. */
function Board() {
  const socket = useSocketSync();
  useNotifications();
  return (
    <Routes>
      <Route path="/" element={<BoardPage socket={socket} />}>
        <Route path="tickets/:id" element={<TicketDrawer />} />
      </Route>
      <Route path="*" element={<BoardPage socket={socket} />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthGate>
      <Board />
    </AuthGate>
  );
}
