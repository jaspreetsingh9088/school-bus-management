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
manifest.write_text(text)
print(text[:900])
