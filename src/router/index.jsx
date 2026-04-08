import { createBrowserRouter } from 'react-router-dom'
import App from '@/App'
import Home from '@/pages/Home'
import Upload from '@/pages/Upload'
import Edit from '@/pages/Edit'
import Generate from '@/pages/Generate'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'upload', element: <Upload /> },
      { path: 'edit', element: <Edit /> },
      { path: 'generate', element: <Generate /> },
    ],
  },
])

export default router
