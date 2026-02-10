import React from 'react';
import { ModelViewer } from '@/app/components/ModelViewer';
import { OuijaLogo } from '@/app/components/OuijaLogo';
import { CodeText } from '@/app/components/CodeText';
import { CodeLarge } from '@/app/components/CodeLarge';
import { OuijaHeaderSmall } from '@/app/components/OuijaHeaderSmall';
import { GameEngineeringText } from '@/app/components/GameEngineeringText';
import { DescriptionText } from '@/app/components/DescriptionText';

const DEFAULT_MODEL = '/models/chara.glb';

export default function App() {
  return (
    <div className="relative size-full bg-[#3a3a3a] overflow-hidden">
      {/* Header Navigation */}
      <header className="absolute top-0 left-0 right-0 flex justify-between items-start px-4 py-4 z-20">
        {/* ouija */}
        <div className="w-[50px] h-[20px]">
          <OuijaHeaderSmall />
        </div>

        {/* game engineering */}
        <div className="w-[140px] h-[16px]">
          <GameEngineeringText />
        </div>

        {/* code */}
        <div className="w-[50px] h-[16px]">
          <CodeText />
        </div>
      </header>

      {/* Main Content */}
      <div className="relative size-full flex items-center justify-center">
        {/* 3D Model Container - Centered, tilted, and rotating */}
        <div className="absolute inset-0 flex items-center justify-center z-5">
          <div className="w-[70%] h-[100%]">
            <ModelViewer modelUrl={DEFAULT_MODEL} />
          </div>
        </div>

        {/* "ouija" logo on the left - behind 3D */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div className="absolute left-[1%] top-[35%] w-[33%]">
            <OuijaLogo />
          </div>
        </div>

        {/* "code" large text on the right - in front of 3D */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="absolute right-[1%] top-[35%] w-[37%]">
            <CodeLarge />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-0 left-0 right-0 flex justify-between items-end px-4 py-4 z-20">
        {/* Social Icons */}
        <div className="flex gap-2 text-[#ffd52d] text-[10px]">
          <span>X</span>
          <span>@</span>
        </div>

        {/* Description */}
        <div className="w-[450px] h-[18px]">
          <DescriptionText />
        </div>

        {/* Additional Info */}
        <div className="text-[#ffd52d] text-[9px] text-right leading-tight">
          <div>coooode</div>
          <div>00000000000000000</div>
        </div>
      </footer>
    </div>
  );
}
