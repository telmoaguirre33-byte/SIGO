import React from 'react';
import { createRoot } from 'react-dom/client';
import InformesOperativos from '../../src/InformesOperativos';
import VentaRapidaOperativa from '../../src/VentaRapidaOperativa';
const Screen = new URLSearchParams(location.search).has('reports') ? InformesOperativos : VentaRapidaOperativa;
createRoot(document.getElementById('root')!).render(<Screen empresaId="00000000-0000-4000-8000-000000000001" />);
