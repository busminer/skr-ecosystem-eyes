import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import App from './App';

global.Buffer = Buffer;
void SplashScreen.preventAutoHideAsync();
registerRootComponent(App);
