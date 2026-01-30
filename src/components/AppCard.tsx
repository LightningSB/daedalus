interface AppCardProps {
  id: string
  name: string
  icon: string
  description: string
  onClick: () => void
}

export function AppCard({ name, icon, description, onClick }: AppCardProps) {
  return (
    <button
      onClick={onClick}
      className="glass glass-hover rounded-2xl p-4 text-left w-full"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold text-white mb-1 truncate">{name}</h3>
      <p className="text-sm text-white/50 line-clamp-2">{description}</p>
    </button>
  )
}
