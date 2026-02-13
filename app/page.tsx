'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { User } from '@supabase/supabase-js'

type Bookmark = {
  id: number
  title: string
  url: string
}

export default function Home() {
  // CRITICAL FIX: Initialize Supabase once using useState to prevent WebSocket crashes
  const [supabase] = useState(() => createClient())

  const [user, setUser] = useState<User | null>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)

  // 1. Auth & Initial Data Load
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) fetchBookmarks()
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchBookmarks()
      else setBookmarks([])
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // 2. Realtime Listener (Handles Syncing from OTHER tabs)
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('realtime bookmarks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookmarks' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setBookmarks((prev) => {
            // Prevent duplicate display if we already added it optimistically
            // We check if an item with the same URL exists or if the ID matches
            const exists = prev.some(b => b.id === payload.new.id || (b.id > 1000000000000 && b.url === payload.new.url))
            if (exists) {
                // If we have a "fake" temporary one, swap it for the real one (logic simplified here by just filtering)
                return prev.map(b => (b.id > 1000000000000 && b.url === payload.new.url) ? (payload.new as Bookmark) : b)
            }
            return [payload.new as Bookmark, ...prev]
          })
        } else if (payload.eventType === 'DELETE') {
          // Removes item when deleted from ANOTHER tab
          setBookmarks((prev) => prev.filter((item) => item.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, user])

  const fetchBookmarks = async () => {
    const { data } = await supabase.from('bookmarks').select('*').order('created_at', { ascending: false })
    if (data) setBookmarks(data)
  }

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // --- OPTIMISTIC ADD (Instant) ---
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !url) return

    // 1. Temporary Fake ID (Timestamp is huge, distinct from DB IDs)
    const tempId = Date.now()
    const tempTitle = title
    const tempUrl = url

    // 2. Show on screen IMMEDIATELY
    const tempBookmark = { id: tempId, title: tempTitle, url: tempUrl }
    setBookmarks((prev) => [tempBookmark, ...prev])

    // 3. Clear inputs IMMEDIATELY
    setTitle('')
    setUrl('')

    // 4. Send to Database (Background)
    let formattedUrl = tempUrl
    if (!/^https?:\/\//i.test(tempUrl)) formattedUrl = 'https://' + tempUrl

    const { error } = await supabase.from('bookmarks').insert({ 
      title: tempTitle, 
      url: formattedUrl 
    })

    // 5. Handle Error
    if (error) {
      // Remove the fake bookmark if DB failed
      setBookmarks((prev) => prev.filter(b => b.id !== tempId))
      alert('Error adding bookmark')
      setTitle(tempTitle) // Restore text
      setUrl(tempUrl)
    }
  }

  // --- OPTIMISTIC DELETE (Instant) ---
  const handleDelete = async (id: number) => {
    // 1. Remove from screen IMMEDIATELY
    setBookmarks((prev) => prev.filter((b) => b.id !== id))

    // 2. Send to Database
    const { error } = await supabase.from('bookmarks').delete().match({ id })
    
    // 3. Handle Error
    if (error) {
      alert('Failed to delete')
      fetchBookmarks() // Restore list if failed
    }
  }

  // --- UI RENDER ---

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
    </div>
  )

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 animate-gradient p-4">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-pink-600 to-purple-600 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative bg-black/40 backdrop-blur-xl p-10 rounded-2xl border border-white/10 shadow-2xl max-w-md w-full text-center">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400 mb-2">
              Smart Bookmarks
            </h1>
            <p className="text-gray-300 mb-8 font-light">Organize your web life in style.</p>
            <button
              onClick={handleLogin}
              className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-gray-200 transition transform hover:scale-105 shadow-lg flex items-center justify-center gap-3"
            >
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-6 h-6" alt="Google" />
              Sign in with Google
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white p-4 sm:p-8 animate-gradient">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-10 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-md shadow-lg">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-gradient-to-tr from-pink-500 to-violet-500 rounded-lg flex items-center justify-center font-bold text-xl shadow-lg">B</div>
            <h1 className="text-2xl font-bold tracking-wide">My Collection</h1>
          </div>
          <button onClick={handleLogout} className="px-5 py-2 bg-red-500/10 hover:bg-red-500/90 text-red-400 hover:text-white border border-red-500/20 rounded-lg transition-all duration-300 text-sm font-medium">
            Sign Out
          </button>
        </div>

        {/* Add Section */}
        <div className="mb-12 relative z-10">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-20"></div>
          <form onSubmit={handleAdd} className="relative bg-black/40 border border-white/10 p-6 rounded-2xl backdrop-blur-xl flex flex-col md:flex-row gap-4 shadow-2xl">
            <input
              type="text"
              placeholder="Title (e.g., Design Inspiration)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 text-white placeholder-gray-400 p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white/10 transition-all"
            />
            <input
              type="text"
              placeholder="URL (e.g., dribbble.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 text-white placeholder-gray-400 p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:bg-white/10 transition-all"
            />
            <button type="submit" className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold px-8 py-4 rounded-xl hover:opacity-90 hover:scale-105 transition-all shadow-lg">
              Add +
            </button>
          </form>
        </div>

        {/* Grid List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bookmarks.map((bm) => (
            <div key={bm.id} className="group relative bg-white/5 hover:bg-white/10 border border-white/5 hover:border-purple-500/50 p-6 rounded-2xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-500/20 flex flex-col justify-between h-44">
              
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <img 
                    src={`https://www.google.com/s2/favicons?domain=${bm.url}&sz=64`} 
                    alt="icon" 
                    className="w-10 h-10 rounded-full bg-white/10 p-1 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/1006/1006771.png' }}
                  />
                  <h3 className="font-bold text-lg truncate text-gray-100 group-hover:text-purple-300 transition-colors">
                    {bm.title}
                  </h3>
                </div>
                
                <button 
                  onClick={() => handleDelete(bm.id)}
                  className="opacity-0 group-hover:opacity-100 p-2 bg-red-500/10 text-red-400 rounded-full hover:bg-red-500 hover:text-white transition-all duration-200"
                  title="Delete"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              <div className="mt-4">
                 <a 
                  href={bm.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white group-hover:underline decoration-pink-500/50 break-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-pink-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Visit Website
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {bookmarks.length === 0 && (
          <div className="text-center mt-20 opacity-50 animate-pulse">
            <div className="text-6xl mb-4">🌌</div>
            <p className="text-xl font-light">Your space is empty.</p>
            <p className="text-sm mt-2">Add a bookmark to get started.</p>
          </div>
        )}

      </div>
    </main>
  )
}