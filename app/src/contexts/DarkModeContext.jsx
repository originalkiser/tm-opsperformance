import { createContext, useContext } from 'react'

export const DarkModeContext = createContext([false, () => {}, 'system'])
export const useDarkModeCtx = () => useContext(DarkModeContext)
