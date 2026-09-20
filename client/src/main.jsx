import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './context/AuthContext.jsx'
import { PlantProvider } from './context/PlantContext.jsx'
import { UIProvider } from './context/UIContext.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <PlantProvider>
        <UIProvider>
          <App />
        </UIProvider>
      </PlantProvider>
    </AuthProvider>
  </React.StrictMode>,
)
