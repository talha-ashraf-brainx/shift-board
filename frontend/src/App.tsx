import { Route, Routes } from 'react-router-dom';
import { TicketDrawer } from './components/TicketDrawer';
import { useSocketSync } from './hooks/useSocketSync';
import { BoardPage } from './pages/BoardPage';

export function App() {
  const socket = useSocketSync();
  return (
    <Routes>
      <Route path="/" element={<BoardPage socket={socket} />}>
        <Route path="tickets/:id" element={<TicketDrawer />} />
      </Route>
      <Route path="*" element={<BoardPage socket={socket} />} />
    </Routes>
  );
}
