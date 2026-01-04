import './style.css'
import { TobariDOMAdapter } from '@tobari/dom-adapter'
import { InvoiceForm, InitialData } from './samples/invoice'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="card">
    <div id="form-container"></div>
  </div>
`

// Initialize Tobari
console.log('Initializing Tobari with Invoice Form...');
const adapter = new TobariDOMAdapter(InvoiceForm, 'form-container', InitialData);

console.log('Tobari initialized', adapter);
