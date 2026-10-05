# Mede picos dos endpoints de saída ativos. Não captura nem persiste áudio.
# Saída única: ATIVO, SILENCIO ou INDETERMINADO. Erro = INDETERMINADO.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  void EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  void GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  void RegisterEndpointNotificationCallback(IntPtr callback);
  void UnregisterEndpointNotificationCallback(IntPtr callback);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  void GetCount(out uint count);
  void Item(uint index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  void Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioMeterInformation meter);
  void OpenPropertyStore(int access, out IntPtr store);
  void GetId(out IntPtr id);
  void GetState(out int state);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
  void GetPeakValue(out float peak);
  void GetMeteringChannelCount(out uint count);
  void GetChannelsPeakValues(uint count, IntPtr peaks);
  void QueryHardwareSupport(out uint mask);
}

public static class MedidorDasSaidas {
  public static bool Ativo() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDeviceCollection devices;
    // eRender = 0, DEVICE_STATE_ACTIVE = 1.
    enumerator.EnumAudioEndpoints(0, 1, out devices);
    uint count;
    devices.GetCount(out count);
    if (count == 0) throw new InvalidOperationException("Sem dispositivo de saída ativo");
    try {
      for (int amostra = 0; amostra < 10; amostra++) {
        for (uint i = 0; i < count; i++) {
          IMMDevice device;
          devices.Item(i, out device);
          try {
            IAudioMeterInformation meter;
            var iid = typeof(IAudioMeterInformation).GUID;
            device.Activate(ref iid, 23, IntPtr.Zero, out meter);
            try {
              float peak;
              meter.GetPeakValue(out peak);
              if (peak > 0.001f) return true;
            } finally { Marshal.ReleaseComObject(meter); }
          } finally { Marshal.ReleaseComObject(device); }
        }
        Thread.Sleep(40);
      }
      return false;
    } finally {
      Marshal.ReleaseComObject(devices);
      Marshal.ReleaseComObject(enumerator);
    }
  }
}
'@ -ErrorAction Stop
  if ([MedidorDasSaidas]::Ativo()) { 'ATIVO' } else { 'SILENCIO' }
} catch {
  'INDETERMINADO'
}
