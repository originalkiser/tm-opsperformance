import { createContext, useContext } from 'react'

export const DarkModeContext = createContext([false, () => {}])
export const useDarkModeCtx = () => useContext(DarkModeContext)
