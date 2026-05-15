const btn = document.getElementById('grantBtn');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Requesting...';
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted! Stop the stream immediately
    stream.getTracks().forEach(t => t.stop());
    
    status.className = 'status success';
    status.textContent = '✅ Microphone access granted! You can close this tab and start recording meetings.';
    btn.textContent = '✅ Permission Granted';
    btn.style.background = '#16a34a';
  } catch (err) {
    status.className = 'status error';
    if (err.name === 'NotAllowedError') {
      status.textContent = "❌ Permission denied. Click the 🔒 icon in Chrome's address bar → Site settings → Microphone → Allow, then try again.";
    } else {
      status.textContent = '❌ Error: ' + err.message;
    }
    btn.disabled = false;
    btn.textContent = '🎤 Try Again';
  }
});
