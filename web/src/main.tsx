import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { CampaignDetail } from './pages/CampaignDetail';
import { CampaignForm } from './pages/CampaignForm';
import { Campaigns } from './pages/Campaigns';
import { Contacts } from './pages/Contacts';
import { DemoKits } from './pages/DemoKits';
import { OptOuts } from './pages/OptOuts';
import { Overview } from './pages/Overview';
import { Replies } from './pages/Replies';
import { WhatsApp } from './pages/WhatsApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="demo-kits" element={<DemoKits />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/new" element={<CampaignForm />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="campaigns/:id/edit" element={<CampaignForm />} />
          <Route path="replies" element={<Replies />} />
          <Route path="opt-outs" element={<OptOuts />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
