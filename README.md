# 劍俠對決 Sword Duel (phone remotes)
2-player sword duel. Big screen: `index.html`. Phones: scan QR → `controller.html?room=XXXX&p=1|2`.
Attacker chops ⬅️⬆️➡️, defender blocks the same direction within ~1 s. 12 turns, roles swap.
Online remote (different places): host picks 🌐 遠程對戰, sends the join link (index.html?join=CODE) to the other screen; each screen shows its own phone QR.
Same-device: 1P A/S/D, 2P J/K/L, or on-screen touch halves.
Tech: three.js, PeerJS (WebRTC, public PeerJS cloud broker), qrcode-generator.
Credits: Knight & Barbarian models — KayKit Adventurers Character Pack by Kay Lousberg (CC0).
