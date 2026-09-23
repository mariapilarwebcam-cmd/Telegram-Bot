  const doRename = async () => {
    if (!newName.trim() || !user || !character) return
    if (newName.trim() === getDisplayName(character)) {
      setShowRename(false)
      return
    }
    if ((user.gems || 0) < GEM_COSTS.rename_character) {
      return alert(
        lang === 'es' ? `Necesitas ${GEM_COSTS.rename_character} gemas` : `You need ${GEM_COSTS.rename_character} gems`
      )
    }
    if (!confirm(t.confirmRename)) return

    setRenaming(true)
    try {
      const res = await fetch('/api/rename-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          character_id: characterId,
          new_name: newName.trim(),
        }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        setCharacter({ ...character, character_name: data.character_name })
        setGems(data.remaining_gems)
        setShowRename(false)
      } else {
        alert(data.message || data.error || t.errorGeneric)
      }
    } catch {
      alert(t.errorConnection)
    } finally {
      setRenaming(false)
    }
  }
