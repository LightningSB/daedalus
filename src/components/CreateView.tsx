import { useState, useEffect } from 'react'
import { useTelegram } from '../hooks/useTelegram'

interface CreateViewProps {
  onBack: () => void
}

const TEMPLATES = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'tracker', label: 'Tracker', icon: '📈' },
  { id: 'calculator', label: 'Calculator', icon: '🧮' },
  { id: 'chart', label: 'Chart', icon: '📉' },
]

export function CreateView({ onBack }: CreateViewProps) {
  const [prompt, setPrompt] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const { showBackButton, impactLight, notificationSuccess } = useTelegram()

  useEffect(() => {
    const cleanup = showBackButton(onBack)
    return cleanup
  }, [showBackButton, onBack])

  const handleTemplateSelect = (templateId: string) => {
    impactLight()
    setSelectedTemplate(selectedTemplate === templateId ? null : templateId)
  }

  const handleCreate = () => {
    notificationSuccess()
    console.log('Creating app with:', {
      prompt,
      template: selectedTemplate,
    })
  }

  const isValid = prompt.trim().length > 0 || selectedTemplate !== null

  return (
    <div className="min-h-screen px-4 py-6">
      {/* Header */}
      <header className="mb-8 animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-1">
          Create New App
        </h1>
        <p className="text-white/50 text-sm">
          Describe your idea or pick a template
        </p>
      </header>

      {/* Prompt Input */}
      <div className="mb-6 animate-fade-in stagger-1">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your app..."
          className="w-full h-32 glass rounded-2xl p-4 text-white placeholder:text-white/30 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
        />
      </div>

      {/* Template Selector */}
      <div className="mb-8 animate-fade-in stagger-2">
        <p className="text-white/50 text-sm mb-3">Or start from a template</p>
        <div className="grid grid-cols-4 gap-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => handleTemplateSelect(template.id)}
              className={`
                glass rounded-xl py-3 px-2 flex flex-col items-center gap-1 transition-all
                ${selectedTemplate === template.id
                  ? 'ring-2 ring-emerald-500 bg-emerald-500/10'
                  : 'glass-hover'
                }
              `}
            >
              <span className="text-xl">{template.icon}</span>
              <span className="text-xs text-white/70">{template.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Create Button */}
      <button
        onClick={handleCreate}
        disabled={!isValid}
        className={`
          w-full rounded-2xl py-4 px-6 font-semibold text-white transition-all animate-fade-in stagger-3
          ${isValid
            ? 'btn-emerald'
            : 'bg-white/10 text-white/30 cursor-not-allowed'
          }
        `}
      >
        Create App
      </button>

      {/* Helper text */}
      <p className="text-center text-white/30 text-xs mt-6 animate-fade-in stagger-4">
        Your app will be generated using AI
      </p>
    </div>
  )
}
