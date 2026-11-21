"""Adds permissions and the app name to the Android project made by `flutter create` in CI."""
import pathlib
import re

manifest = pathlib.Path('android/app/src/main/AndroidManifest.xml')
text = manifest.read_text()

permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
]
lines = ''.join(f'\n    <uses-permission android:name="{p}" />' for p in permissions if p not in text)
text = re.sub(r'(<manifest[^>]*>)', r'\1' + lines, text, count=1)
text = re.sub(r'android:label="[^"]*"', 'android:label="School Bus"', text, count=1)
# Let url_launcher open Google Maps / the dialer (Android 11+ package visibility)
if '<queries>' in text and 'android.intent.action.VIEW' not in text.split('<queries>')[1]:
    text = text.replace('<queries>', '<queries>\n        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="https" /></intent>\n        <intent><action android:name="android.intent.action.DIAL" /><data android:scheme="tel" /></intent>', 1)
elif '<queries>' not in text:
    text = text.replace('</manifest>', '    <queries>\n        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="https" /></intent>\n        <intent><action android:name="android.intent.action.DIAL" /><data android:scheme="tel" /></intent>\n    </queries>\n</manifest>', 1)
manifest.write_text(text)
print(text[:900])
